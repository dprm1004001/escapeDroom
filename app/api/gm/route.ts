import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { clampStats, GameMasterTurnSchema } from "@/lib/gameMasterSchema";
import { buildGameMasterSystemPrompt, formatPlayerTurn, RESTROOM_SCENARIO } from "@/lib/prompts/gameMasterPrompt";
import { checkRateLimit, getClientKey } from "@/lib/rateLimit";

// API 키는 서버에서만 쓴다. 이 파일은 절대 클라이언트로 번들되지 않는다.
export const runtime = "nodejs";
// 생각하는 시간이 길어질 수 있으므로 기본 10초보다 늘려 잡는다.
export const maxDuration = 60;

const MODEL = "claude-opus-5-5";
const MAX_INPUT_LENGTH = 500;

/** 클라이언트가 보내는 요청 형식 */
const RequestSchema = z.object({
  input: z.string().min(1).max(MAX_INPUT_LENGTH),
  turn: z.number().int().min(1).max(RESTROOM_SCENARIO.maxTurns),
  /** 이전 턴들의 대화. 서버는 상태를 갖지 않으므로 클라이언트가 매번 보낸다. */
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .max(RESTROOM_SCENARIO.maxTurns * 2)
    .default([]),
});

const SYSTEM_PROMPT = buildGameMasterSystemPrompt(RESTROOM_SCENARIO);

const client = new Anthropic();

function errorResponse(message: string, status: number, extraHeaders?: HeadersInit) {
  return Response.json({ error: message }, { status, headers: extraHeaders });
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return errorResponse("서버에 API 키가 설정되지 않았습니다.", 500);
  }

  const limit = checkRateLimit(getClientKey(req));
  if (!limit.ok) {
    return errorResponse(`잠시 후 다시 시도하세요. (${limit.retryAfter}초)`, 429, {
      "Retry-After": String(limit.retryAfter),
    });
  }

  const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("잘못된 요청입니다.", 400);
  }
  const { input, turn, history } = parsed.data;

  try {
    const message = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // 시스템 프롬프트는 게임 내내 고정 → 캐시에 태워 비용을 줄인다.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [...history, { role: "user", content: formatPlayerTurn(turn, input) }],
      output_format: zodOutputFormat(GameMasterTurnSchema),
      // 게임 진행은 빠른 응답이 중요해서 중간 단계로 둔다. 판정이 얕다고 느끼면 "high"로 올린다.
      output_config: { effort: "medium" },
      // 안전 분류기가 거절하면 같은 요청을 대체 모델로 자동 재시도한다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    if (message.stop_reason === "refusal") {
      return errorResponse("게임마스터가 그 행동에는 응답하지 않았습니다. 다른 행동을 시도하세요.", 422);
    }

    const result = message.parsed_output;
    if (!result) {
      return errorResponse("게임마스터의 응답을 해석하지 못했습니다.", 502);
    }

    // 모델이 턴 수를 틀리게 세는 경우가 있어 서버 기준으로 덮어쓴다.
    const gameTurn = clampStats(result, turn);

    return Response.json({
      turn: gameTurn,
      // 다음 요청에 그대로 돌려줄 대화 기록 (클라이언트가 보관)
      exchange: [
        { role: "user" as const, content: formatPlayerTurn(turn, input) },
        { role: "assistant" as const, content: JSON.stringify(gameTurn) },
      ],
    });
  } catch (error) {
    // 구체적인 것부터 순서대로 — 재시도 가능한 오류와 아닌 것을 구분한다.
    if (error instanceof Anthropic.RateLimitError) {
      return errorResponse("요청이 몰리고 있습니다. 잠시 후 다시 시도하세요.", 429);
    }
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic auth failed");
      return errorResponse("서버 설정 오류입니다.", 500);
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}:`, error.message);
      return errorResponse("게임마스터와 연결하지 못했습니다.", 502);
    }
    console.error("Unexpected error in /api/gm:", error);
    return errorResponse("알 수 없는 오류가 발생했습니다.", 500);
  }
}
