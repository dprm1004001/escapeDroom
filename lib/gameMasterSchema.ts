/** AI 게임마스터가 매 턴 반환하는 JSON */
export interface GameMasterTurn {
  description: string;
  is_game_over: boolean;
  final_stats: FinalStats;
}

export interface FinalStats {
  /** 행동의 논리성 (0~100) */
  logic: number;
  /** 창의성/유머 (0~100) */
  wit: number;
  /** 소요된 턴 수 */
  turns_taken: number;
  /** CLI 스타일 해시태그, 예: "--tag #광기의_연금술사" */
  hidden_tags: string[];
  /** 유저 입력 중 가장 골때리거나 결정적이었던 한 줄 (원문 그대로) */
  best_quote: string;
  /** 게임마스터의 한 줄 평가 */
  ai_comment: string;
}

/**
 * Structured outputs(`output_config.format`)용 JSON Schema.
 * API가 minimum/maximum 같은 수치 제약을 지원하지 않으므로 범위는 description에만 적고,
 * 서버에서 clampStats()로 한 번 더 보정한다.
 */
export const GAME_MASTER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "is_game_over", "final_stats"],
  properties: {
    description: {
      type: "string",
      description: "현재 상황 묘사 및 유저 행동의 결과. 마크다운 없이 평문, 줄바꿈은 \\n.",
    },
    is_game_over: {
      type: "boolean",
      description: "탈출 성공 또는 사망/실패로 게임이 끝났으면 true.",
    },
    final_stats: {
      type: "object",
      additionalProperties: false,
      required: ["logic", "wit", "turns_taken", "hidden_tags", "best_quote", "ai_comment"],
      properties: {
        logic: { type: "integer", description: "행동의 논리성 점수, 0~100" },
        wit: { type: "integer", description: "창의성/유머 점수, 0~100" },
        turns_taken: { type: "integer", description: "소요된 턴 수" },
        hidden_tags: {
          type: "array",
          items: { type: "string" },
          description: '게임 종료 시 부여하는 태그. 형식: "--tag #태그_이름". 진행 중에는 빈 배열.',
        },
        best_quote: { type: "string", description: "유저 입력 중 한 줄, 원문 그대로" },
        ai_comment: { type: "string", description: "게임마스터의 한 줄 평가. 진행 중에는 빈 문자열." },
      },
    },
  },
} as const;

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
