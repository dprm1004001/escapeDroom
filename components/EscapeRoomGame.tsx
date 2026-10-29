"use client";

/**
 * ESCAPE_ — 텍스트 방탈출 TRPG 컨테이너 컴포넌트
 *
 * AI 게임마스터 응답은 서버 라우트(/api/gm)를 통해 받는다.
 * API 키는 서버에만 있고 이 파일에는 들어오지 않는다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getEnding, type Ending, type FinalStats, type GameMasterTurn } from "@/lib/gameMasterSchema";
import { RESTROOM_SCENARIO } from "@/lib/prompts/gameMasterPrompt";

/* ════════════════════════════════ 타입 ════════════════════════════════ */

type Role = "gm" | "user" | "system";

interface LogEntry {
  id: number;
  role: Role;
  text: string;
  /** 사망·실패·오류 → 빨간색 */
  alert?: boolean;
}

type GameStatus = "playing" | "over";

interface GameResult {
  ending: Ending;
  stats: FinalStats;
}

/** 서버에 되돌려 보낼 대화 기록 한 줄 */
interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

/* ════════════════════════════════ 설정 ════════════════════════════════ */

const LOCATION = RESTROOM_SCENARIO.location;
const MAX_INPUT_LENGTH = 500;

const INITIAL_HISTORY: LogEntry[] = [
  { id: 0, role: "system", text: "SESSION 01 — CONNECTION ESTABLISHED" },
  {
    id: 1,
    role: "gm",
    text: "눈을 뜨자 차가운 타일 바닥이 뺨에 닿는다.\n형광등 하나가 불규칙하게 깜빡이고, 세면대 위의 거울에는 금이 가 있다.\n출입문은 밖에서 잠겨 있다.",
  },
];

const pad2 = (n: number) => String(n).padStart(2, "0");

const ENDING_THEME = {
  escaped: {
    label: "ESCAPED",
    accent: "#CCFF00",
    text: "text-[#CCFF00]",
    badge: "border-[#CCFF00]/30 bg-[#CCFF00]/[0.07] text-[#CCFF00]",
  },
  dead: {
    label: "SIGNAL_LOST",
    accent: "#FF3B3B",
    text: "text-[#FF3B3B]",
    badge: "border-[#FF3B3B]/30 bg-[#FF3B3B]/[0.07] text-[#FF3B3B]",
  },
  game_over: {
    label: "GAME_OVER",
    accent: "#FF3B3B",
    text: "text-[#FF3B3B]",
    badge: "border-[#FF3B3B]/30 bg-[#FF3B3B]/[0.07] text-[#FF3B3B]",
  },
} as const;

const KEYFRAMES = `
@keyframes escBlink { 0%, 100% { opacity: 1 } 50% { opacity: 0 } }
@keyframes escFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes escRise { from { opacity: 0; transform: translateY(24px) scale(0.98) } to { opacity: 1; transform: none } }
@keyframes escPulse { 50% { opacity: 0.35 } }
`;


/* ════════════════════════════════ API 호출 ════════════════════════════════ */

interface GameMasterResponse {
  turn: GameMasterTurn;
  exchange: ApiMessage[];
}

async function requestGameMaster(
  input: string,
  turn: number,
  history: ApiMessage[],
  signal: AbortSignal,
): Promise<GameMasterResponse> {
  const res = await fetch("/api/gm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, turn, history }),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "게임마스터와 연결하지 못했습니다.");
  }
  return res.json();
}

/* ════════════════════════════════ 컨테이너 ════════════════════════════════ */

export default function EscapeRoomGame() {
  const [history, setHistory] = useState<LogEntry[]>(INITIAL_HISTORY);
  const [input, setInput] = useState("");
  const [gameStatus, setGameStatus] = useState<GameStatus>("playing");
  const [result, setResult] = useState<GameResult | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [isCardOpen, setIsCardOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextIdRef = useRef(INITIAL_HISTORY.length);
  const turnRef = useRef(0);
  // 서버는 상태를 갖지 않으므로 대화 기록을 여기서 들고 매번 함께 보낸다
  const apiHistoryRef = useRef<ApiMessage[]>([]);
  // ↑ / ↓ 명령어 히스토리 (렌더와 무관하므로 ref)
  const commandsRef = useRef<string[]>([]);
  const commandCursorRef = useRef(-1);

  const isOver = gameStatus === "over";
  const failed = result !== null && result.ending !== "escaped";

  const appendLog = (role: Role, text: string, alert = false) =>
    setHistory((prev) => [...prev, { id: nextIdRef.current++, role, text, alert }]);

  const submit = async () => {
    const command = input.trim();
    if (!command || isThinking || isOver) return;

    if (command.length > MAX_INPUT_LENGTH) {
      appendLog("system", `행동은 ${MAX_INPUT_LENGTH}자까지 입력할 수 있습니다.`, true);
      return;
    }

    const turn = turnRef.current + 1;
    commandsRef.current.unshift(command);
    commandCursorRef.current = -1;

    appendLog("user", command);
    setInput("");
    setIsThinking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { turn: response, exchange } = await requestGameMaster(
        command,
        turn,
        apiHistoryRef.current,
        controller.signal,
      );

      // 요청이 성공한 뒤에만 턴과 대화 기록을 확정한다
      turnRef.current = turn;
      apiHistoryRef.current = [...apiHistoryRef.current, ...exchange];

      const ending = getEnding(response);
      const isFailure = ending !== null && ending !== "escaped";
      appendLog("gm", response.description, isFailure);

      if (ending) {
        appendLog("system", isFailure ? "SESSION TERMINATED — GAME OVER" : "SESSION TERMINATED — ESCAPED", isFailure);
        setResult({ ending, stats: response.final_stats });
        setGameStatus("over");
        setIsCardOpen(true);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return; // 재시작으로 취소됨
      // 실패한 턴은 세지 않으므로 그대로 다시 입력하면 된다
      appendLog("system", `SIGNAL LOST — ${error instanceof Error ? error.message : "연결 실패"}`, true);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsThinking(false);
    }
  };

  const restart = () => {
    abortRef.current?.abort();
    nextIdRef.current = INITIAL_HISTORY.length;
    turnRef.current = 0;
    apiHistoryRef.current = [];
    setHistory(INITIAL_HISTORY);
    setInput("");
    setResult(null);
    setIsThinking(false);
    setIsCardOpen(false);
    setGameStatus("playing");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 한글 조합 중 Enter 무시 (마지막 글자 중복 전송 방지)
    if (e.nativeEvent.isComposing) return;

    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const commands = commandsRef.current;
      if (commands.length === 0) return;
      e.preventDefault();
      const cursor = commandCursorRef.current;
      const next = e.key === "ArrowUp" ? Math.min(cursor + 1, commands.length - 1) : Math.max(cursor - 1, -1);
      commandCursorRef.current = next;
      setInput(next === -1 ? "" : commands[next]);
    }
  };

  // 새 로그가 쌓이면 맨 아래로
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [history, isThinking]);

  // 응답이 끝나거나 재시작하면 입력창 포커스
  useEffect(() => {
    if (!isThinking && gameStatus === "playing") inputRef.current?.focus();
  }, [isThinking, gameStatus]);

  // 언마운트 시 진행 중인 요청 취소
  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <main
      onMouseUp={() => {
        if (!window.getSelection()?.toString()) inputRef.current?.focus();
      }}
      className="flex h-dvh flex-col bg-[#050505] font-mono text-[#F0F0F0] antialiased selection:bg-[#CCFF00] selection:text-[#050505]"
    >
      <style>{KEYFRAMES}</style>

      {/* ── 상단: 현재 위치 ── */}
      <header className="shrink-0 border-b border-[#F0F0F0]/10">
        <div className="mx-auto flex max-w-3xl items-baseline gap-2 px-4 py-3 text-[11px] uppercase tracking-[0.2em] sm:px-8">
          <span className="text-[#F0F0F0]/40">LOCATION:</span>
          <span className="text-[#CCFF00]">{LOCATION}</span>
        </div>
      </header>

      {/* ── 중앙: 로그 ── */}
      <section aria-live="polite" className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgb(240_240_240/0.12)_transparent] [scrollbar-width:thin]">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 text-sm leading-7 sm:px-8">
          {history.map((entry, i) => (
            <LogLine key={entry.id} entry={entry} withCursor={!isThinking && i === history.length - 1} />
          ))}
          {isThinking && (
            <p className="text-[11px] uppercase tracking-[0.2em] text-[#F0F0F0]/30">
              {"// GM IS TYPING"}
              <Cursor />
            </p>
          )}
          <div ref={logEndRef} />
        </div>
      </section>

      {/* ── 하단: 입력 ── */}
      <footer className="shrink-0 border-t border-[#F0F0F0]/10">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-4 sm:px-8">
          <label className="flex flex-1 items-center gap-3">
            <span aria-hidden className={`select-none text-sm ${failed ? "text-[#FF3B3B]" : "text-[#CCFF00]"}`}>
              {">"}
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={MAX_INPUT_LENGTH}
              disabled={isOver || isThinking}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              aria-label="행동 입력"
              placeholder={isOver ? "SESSION TERMINATED" : isThinking ? "PROCESSING..." : "행동을 입력하세요"}
              className={`w-full bg-transparent text-base text-[#F0F0F0] caret-[#CCFF00] outline-none disabled:cursor-default sm:text-sm ${
                failed ? "placeholder:text-[#FF3B3B]/50" : "placeholder:text-[#F0F0F0]/20"
              }`}
            />
          </label>
          {isOver && !isCardOpen && (
            <button
              type="button"
              onClick={() => setIsCardOpen(true)}
              className={`shrink-0 text-[11px] uppercase tracking-[0.2em] transition-opacity hover:opacity-70 ${
                failed ? "text-[#FF3B3B]" : "text-[#CCFF00]"
              }`}
            >
              [ RESULT ]
            </button>
          )}
        </div>
      </footer>

      {/* ── 결과 카드 ── */}
      {result && isCardOpen && (
        <ResultOverlay result={result} onRestart={restart} onClose={() => setIsCardOpen(false)} />
      )}
    </main>
  );
}

/* ════════════════════════════════ 로그 ════════════════════════════════ */

function LogLine({ entry, withCursor }: { entry: LogEntry; withCursor: boolean }) {
  const cursor = withCursor ? <Cursor alert={entry.alert} /> : null;

  if (entry.role === "system") {
    return (
      <p className={`text-[11px] uppercase tracking-[0.2em] ${entry.alert ? "text-[#FF3B3B]" : "text-[#F0F0F0]/30"}`}>
        {"// "}
        {entry.text}
        {cursor}
      </p>
    );
  }

  if (entry.role === "user") {
    return (
      <p className="whitespace-pre-wrap break-words text-[#CCFF00]">
        <span className="select-none text-[#CCFF00]/50">{"> "}</span>
        {entry.text}
        {cursor}
      </p>
    );
  }

  return (
    <p className={`whitespace-pre-wrap break-words ${entry.alert ? "text-[#FF3B3B]" : "text-[#F0F0F0]"}`}>
      {entry.text}
      {cursor}
    </p>
  );
}

function Cursor({ alert, className = "ml-1" }: { alert?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`${className} animate-[escBlink_1s_step-end_infinite] ${alert ? "text-[#FF3B3B]" : "text-[#CCFF00]"}`}
    >
      _
    </span>
  );
}

/* ════════════════════════════════ 결과 오버레이 ════════════════════════════════ */

function ResultOverlay({
  result,
  onRestart,
  onClose,
}: {
  result: GameResult;
  onRestart: () => void;
  onClose: () => void;
}) {
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const share = async () => {
    const text = buildShareText(result);
    const url = window.location.href;
    try {
      // 모바일: 시스템 공유 시트 (인스타·카톡 등) / 데스크톱: 클립보드 복사
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "ESCAPE_", text, url });
        return;
      }
      await copyText(`${text}\n${url}`);
      setShareState("copied");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // 공유 시트 닫음
      setShareState("failed");
    }
    setTimeout(() => setShareState("idle"), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="최종 결과"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="fixed inset-0 z-50 flex animate-[escFadeIn_0.5s_ease-out_0.5s_both] flex-col items-center justify-center bg-[#050505]/80 px-4 py-6 backdrop-blur-sm"
    >
      {/* 카드 + 버튼이 화면 높이 안에 들어가도록 9:16 기준으로 너비 계산 */}
      <div className="flex w-[min(100%,calc((100dvh_-_9rem)*9/16),24rem)] animate-[escRise_0.7s_cubic-bezier(0.16,1,0.3,1)_0.6s_both] flex-col gap-3">
        <ScoreCard result={result} />

        <div className="grid grid-cols-2 gap-3 text-xs font-bold tracking-wider">
          <button
            type="button"
            onClick={onRestart}
            className="h-11 border border-[#CCFF00] text-[#CCFF00] transition-colors hover:bg-[#CCFF00]/10"
          >
            다시 시도하기
          </button>
          <button
            type="button"
            onClick={share}
            className="h-11 bg-[#CCFF00] text-[#050505] transition-opacity hover:opacity-85"
          >
            {shareState === "copied" ? "복사 완료_" : shareState === "failed" ? "공유 실패" : "SNS에 공유하기"}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="self-center py-1 text-[10px] uppercase tracking-[0.2em] text-[#F0F0F0]/35 transition-colors hover:text-[#F0F0F0]"
        >
          [ESC] VIEW LOG
        </button>
      </div>
    </div>
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);

  // Clipboard API가 없는 http(비보안) 환경 대비 — 예: 휴대폰에서 192.168.x.x로 접속
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(el);
  el.select();
  const ok = document.execCommand("copy");
  el.remove();
  if (!ok) throw new Error("copy failed");
}

function buildShareText({ ending, stats }: GameResult): string {
  return [
    `[STATUS: ${ENDING_THEME[ending].label}] ESCAPE_ // ${LOCATION}`,
    `LOGIC ${stats.logic}% · WIT ${stats.wit}% · TURNS ${pad2(stats.turns_taken)}`,
    stats.hidden_tags.join(" "),
    stats.best_quote && `> "${stats.best_quote}"`,
    stats.ai_comment && `— ${stats.ai_comment}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ════════════════════════════════ 결과 카드 (9:16) ════════════════════════════════ */

/** 모든 치수가 cqw(카드 너비 기준)라서 어떤 크기로 렌더·캡처해도 레이아웃이 같다 */
function ScoreCard({ result }: { result: GameResult }) {
  const { stats, ending } = result;
  const t = ENDING_THEME[ending];
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", ".");

  return (
    <article
      style={{ containerType: "inline-size" }}
      className="aspect-[9/16] w-full overflow-hidden border border-[#222222] bg-[#050505]/85 text-[#F0F0F0] shadow-[0_0_80px_-20px_#000]"
    >
      <div className="flex h-full flex-col p-[7cqw]">
        {/* 헤더 */}
        <header className="flex flex-col items-start gap-[3cqw]">
          <span
            className={`inline-flex items-center gap-[2cqw] rounded-full border px-[3.2cqw] py-[1.5cqw] text-[length:3cqw] leading-none tracking-[0.12em] ${t.badge}`}
          >
            <span
              className="size-[1.5cqw] animate-[escPulse_2s_ease-in-out_infinite] rounded-full"
              style={{ backgroundColor: t.accent, boxShadow: `0 0 8px ${t.accent}` }}
            />
            [STATUS: {t.label}]
          </span>
          <p className="text-[length:2.6cqw] uppercase tracking-[0.2em] text-[#F0F0F0]/35">
            SESSION 01 <span className="text-[#F0F0F0]/20">{"//"}</span> {LOCATION}
          </p>
        </header>

        {/* 메인 스탯 */}
        <section className="flex flex-1 flex-col justify-center gap-[5.5cqw]">
          <StatRow label="LOGIC" value={String(stats.logic)} unit="%" progress={stats.logic} accent={t.accent} />
          <StatRow label="WIT" value={String(stats.wit)} unit="%" progress={stats.wit} accent={t.accent} />
          <StatRow label="TURNS" value={pad2(stats.turns_taken)} accent={t.accent} />
        </section>

        {/* 태그 · 명대사 · 총평 */}
        <section className="flex flex-col gap-[4.5cqw]">
          {stats.hidden_tags.length > 0 && (
            <ul className="flex flex-col gap-[1.4cqw] text-[length:3.4cqw] leading-snug">
              {stats.hidden_tags.map((tag) => {
                const match = tag.match(/^(--\S+)\s+(.*)$/);
                return (
                  <li key={tag} className="truncate">
                    {match ? (
                      <>
                        <span className="text-[#F0F0F0]/35">{match[1]}</span> <span className={t.text}>{match[2]}</span>
                      </>
                    ) : (
                      tag
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {stats.best_quote && (
            <p className="line-clamp-2 text-[length:2.9cqw] leading-relaxed text-[#F0F0F0]/40">
              {"> User input: "}&quot;{stats.best_quote}&quot;
            </p>
          )}

          {stats.ai_comment && (
            <blockquote
              className="line-clamp-4 border-l-2 py-[2.4cqw] pl-[3.6cqw] pr-[2cqw] text-[length:3.5cqw] leading-relaxed text-[#F0F0F0]/80"
              style={{ borderColor: t.accent, backgroundImage: `linear-gradient(to right, ${t.accent}14, transparent)` }}
            >
              {stats.ai_comment}
              <Cursor alert={ending !== "escaped"} className="ml-[1cqw]" />
            </blockquote>
          )}
        </section>

        {/* 푸터 */}
        <footer className="mt-[5cqw] flex items-center justify-between border-t border-[#222222] pt-[3cqw] text-[length:2.5cqw] uppercase tracking-[0.2em] text-[#F0F0F0]/30">
          <span>
            <span className={t.text}>&gt;</span> ESCAPE_
          </span>
          <span>{date}</span>
        </footer>
      </div>
    </article>
  );
}

function StatRow({
  label,
  value,
  unit,
  progress,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  progress?: number;
  accent: string;
}) {
  return (
    <div className="flex flex-col gap-[2.2cqw]">
      <div className="flex items-baseline justify-between font-bold leading-none">
        <span className="text-[length:7cqw] tracking-tight text-[#F0F0F0]/45">{label}</span>
        <span className="text-[length:15cqw] tracking-tighter">
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(to bottom, #F0F0F0, rgba(240,240,240,0.55))" }}
          >
            {value}
          </span>
          {unit && (
            <span className="ml-[0.5cqw] text-[length:8cqw]" style={{ color: accent }}>
              {unit}
            </span>
          )}
        </span>
      </div>
      <div className="h-px w-full bg-[#222222]">
        {progress !== undefined && (
          <div className="h-full" style={{ width: `${progress}%`, backgroundColor: accent }} />
        )}
      </div>
    </div>
  );
}
