import { Router } from "express";
import OpenAI from "openai";
import { db } from "../db/index.js";
import { eventLogs } from "../db/schema.js";
import { desc } from "drizzle-orm";

const router = Router();

const EVENT_TYPE_KO = {
  MATERIAL_RECEIPT:    "원자재 입고",
  FIRST_PROCESS_START: "1차공정 시작",
  FIRST_PROCESS_DONE:  "1차공정 완료",
  DEFECT_STOP:         "공정불량 중단",
  SHORT_RECORD:        "불량(쇼트) 기록",
  FIRST_TO_SECOND:     "1차→2차 투입",
  SECOND_PROCESS_DONE: "2차공정 완료",
  WORK_START:          "작업 시작",
  WORK_DONE:           "작업 완료",
  PROCESS_DEFECT:      "공정불량",
};

const MATERIAL_KO = {
  CHIP:          "칩",
  FABRIC:        "원단",
  STICKER_PAPER: "스티커지",
};

router.post("/", async (req, res) => {
  const { message, context, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "message가 필요합니다." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY가 설정되지 않았습니다. server/.env를 확인하세요." });
  }

  // 집계용 전체 로그, 프롬프트용 최근 50건
  const allLogs = db.select().from(eventLogs).orderBy(desc(eventLogs.timestamp)).limit(500).all();
  const logs = allLogs.slice(0, 50);

  const logsText = logs.length > 0
    ? logs.map((l) => {
        const parts = [
          `[${(l.timestamp ?? "").slice(0, 16)}]`,
          EVENT_TYPE_KO[l.eventType] ?? l.eventType,
        ];
        if (l.orderId)      parts.push(`오더:${l.orderId}`);
        if (l.sessionType)  parts.push(`공정:${l.sessionType === "FIRST" ? "1차" : "2차"}`);
        if (l.machineId)    parts.push(`기계:${l.machineId}호`);
        if (l.qty != null)  parts.push(`수량:${l.qty.toLocaleString()}`);
        if (l.materialType) parts.push(`자재:${MATERIAL_KO[l.materialType] ?? l.materialType}`);
        if (l.note)         parts.push(`메모:${l.note}`);
        return parts.join(" | ");
      }).join("\n")
    : "기록된 이벤트 로그가 없습니다.";

  const eventCounts = {};
  let totalShortQty = 0;
  let totalSecondDoneQty = 0;
  allLogs.forEach((l) => {
    eventCounts[l.eventType] = (eventCounts[l.eventType] ?? 0) + 1;
    if (l.eventType === "SHORT_RECORD" && l.qty) totalShortQty += l.qty;
    if (l.eventType === "SECOND_PROCESS_DONE" && l.qty) totalSecondDoneQty += l.qty;
  });
  const shortRate = totalSecondDoneQty > 0
    ? ((totalShortQty / (totalSecondDoneQty + totalShortQty)) * 100).toFixed(1)
    : "0.0";

  const systemPrompt = `당신은 한국 의류 제조 공장의 MES AI 어시스턴트입니다.
아래 대시보드 현황과 이벤트 로그를 분석해서 사용자 질문에 답하세요.

[답변 규칙]
- 항상 한국어로 답변합니다.
- 이벤트 로그의 타임스탬프, 수량, 패턴을 적극 활용하세요.
- 구체적인 수치(횟수, 수량, 비율)를 포함해 간결하게 답변하세요.
- 데이터에 없는 내용은 추측하지 말고 "로그에서 확인되지 않습니다"라고 하세요.
- 줄바꿈을 적절히 사용해 읽기 좋게 구성하세요.

[이벤트 유형 설명]
- 원자재 입고: 원단/칩/스티커지 입고 기록
- 1차공정 시작/완료: 원단→롤 변환 공정
- 1차→2차 투입: 1차 공정 롤이 2차 공정으로 투입됨 (재고 차감)
- 2차공정 완료: 롤→완제품(라벨) 생산 완료
- 공정불량 중단: 작업 중 불량으로 재시작 필요
- 불량(쇼트) 기록: 생산 중 발생한 불량 수량

[이벤트 로그 집계 (전체 ${allLogs.length}건 기준)]
- 이벤트 유형별 횟수: ${JSON.stringify(Object.fromEntries(Object.entries(eventCounts).map(([k, v]) => [EVENT_TYPE_KO[k] ?? k, v])))}
- 2차공정 생산 합계: ${totalSecondDoneQty.toLocaleString()}개
- 불량(쇼트) 합계: ${totalShortQty.toLocaleString()}개
- 로그 기준 쇼트율: ${shortRate}%

[현재 대시보드 현황]
${JSON.stringify(context ?? {}, null, 2)}

[최근 이벤트 로그 (최신 ${logs.length}건, 최신순 — 집계는 ${allLogs.length}건 전체 기준)]
${logsText}`;

  try {
    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const messages = [
      { role: "system", content: systemPrompt },
      ...history
        .filter((h) => h.text?.trim())
        .map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.text })),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: 1024,
    });

    const reply = completion.choices[0]?.message?.content?.trim() ?? "응답을 생성하지 못했습니다.";
    res.json({ reply });
  } catch (err) {
    console.error("OpenAI API 오류:", err.message);
    res.status(500).json({ error: err.message ?? "AI 응답 생성 실패" });
  }
});

export default router;
