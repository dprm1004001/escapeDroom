import { z } from "zod";

/**
 * AI 게임마스터가 매 턴 반환하는 JSON.
 * 이 Zod 스키마가 곧 구조화 출력(structured outputs) 스키마이자 런타임 검증기다.
 *
 * 주의: API의 JSON Schema는 minimum/maximum 같은 수치 제약을 지원하지 않는다.
 * 점수 범위는 describe()로만 알려주고, 실제 보정은 clampStats()가 한다.
 */
export const FinalStatsSchema = z.object({
  logic: z.number().int().describe("행동의 논리성 점수, 0~100"),
  wit: z.number().int().describe("창의성/유머 점수, 0~100"),
  turns_taken: z.number().int().describe("소요된 턴 수"),
  hidden_tags: z
    .array(z.string())
    .describe('게임 종료 시 부여하는 태그. 형식: "--tag #태그_이름". 진행 중에는 빈 배열.'),
  best_quote: z.string().describe("유저 입력 중 한 줄, 원문 그대로"),
  ai_comment: z.string().describe("게임마스터의 한 줄 평가. 진행 중에는 빈 문자열."),
});

export const GameMasterTurnSchema = z.object({
  description: z.string().describe("현재 상황 묘사 및 유저 행동의 결과. 마크다운 없이 평문, 줄바꿈은 \\n."),
  is_game_over: z.boolean().describe("탈출 성공 또는 사망/실패로 게임이 끝났으면 true."),
  final_stats: FinalStatsSchema,
});

export type FinalStats = z.infer<typeof FinalStatsSchema>;
export type GameMasterTurn = z.infer<typeof GameMasterTurnSchema>;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** 모델 출력의 점수 범위와 턴 수를 서버 기준으로 보정 */
export function clampStats(turn: GameMasterTurn, actualTurns: number): GameMasterTurn {
  return {
    ...turn,
    final_stats: {
      ...turn.final_stats,
      logic: clamp(turn.final_stats.logic, 0, 100),
      wit: clamp(turn.final_stats.wit, 0, 100),
      turns_taken: actualTurns,
    },
  };
}

export type Ending = "escaped" | "dead" | "game_over";

/** description 마지막 줄의 결말 마커로 엔딩 종류 판별 (시스템 프롬프트 <tone> 참고) */
export function getEnding(turn: GameMasterTurn): Ending | null {
  if (!turn.is_game_over) return null;
  if (turn.description.includes("[ESCAPED]")) return "escaped";
  if (turn.description.includes("[SIGNAL LOST]")) return "dead";
  return "game_over";
}
