import "dotenv/config";
import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { initDb } from "./db/index.js";

import ordersRouter from "./routes/orders.js";
import rawStocksRouter from "./routes/rawStocks.js";
import firstProcessRouter from "./routes/firstProcess.js";
import secondProcessRouter from "./routes/secondProcess.js";
import eventLogsRouter from "./routes/eventLogs.js";
import chatRouter from "./routes/chat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// DB 초기화 (테이블 없으면 생성)
initDb();

// 라우터
app.use("/api/orders",         ordersRouter);
app.use("/api/raw-stocks",     rawStocksRouter);
app.use("/api/first-process",  firstProcessRouter);
app.use("/api/second-process", secondProcessRouter);
app.use("/api/event-logs",     eventLogsRouter);
app.use("/api/chat",           chatRouter);

// 헬스체크
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// 프론트엔드 정적 파일 서빙 (프로덕션)
const distPath = join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (req, res) => {
  res.sendFile(join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
});
