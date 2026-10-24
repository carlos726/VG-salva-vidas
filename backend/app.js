const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const DB_FILE = path.join(__dirname, "db.json");
const isProduction = process.env.NODE_ENV === "production";
const sessions = new Map();
const loginAttempts = new Map();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({ origin: true, credentials: true, methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json({ limit: "32kb" }));

const defaultDB = () => ({ usuarios: [], pacientes: [], triagens: [], consultas: [], tv_chamada: null, tv_historico: [] });
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return defaultDB();
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    return { ...defaultDB(), ...db };
  } catch (error) {
    console.error("Erro ao ler banco local:", error.message);
    return defaultDB();
  }
}
function writeDB(data) {
  const temporaryFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryFile, DB_FILE);
}
function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function id() { return crypto.randomUUID(); }
function hashPassword(password) {
  return crypto.scryptSync(password, "vg-salva-vidas-salt", 32).toString("hex");
}
function passwordMatches(stored, supplied) {
  const expected = hashPassword(supplied);
  const actual = stored.length === expected.length ? stored : hashPassword(stored);
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function setSession(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { ...user, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });
  const secure = isProduction ? "; Secure" : "";
  res.setHeader("Set-Cookie", `vg_session=${token}; HttpOnly; SameSite=Lax; Max-Age=${8 * 60 * 60}; Path=/${secure}`);
}
function requireAuth(req, res, next) {
  const token = req.headers.cookie?.match(/(?:^|; )vg_session=([^;]+)/)?.[1];
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
  req.user = session;
  next();
}
function validateText(body, fields) {
  return fields.every(([field, max]) => clean(body[field], max));
}
const protectedRoutes = ["/atendimento", "/pacientes", "/triagem", "/triagens", "/consulta", "/medicacoes", "/api/analisar-ia"];
app.use((req, res, next) => protectedRoutes.includes(req.path) ? requireAuth(req, res, next) : next());

app.post("/login", (req, res) => {
  const usuario = clean(req.body?.usuario, 80).toLowerCase();
  const senha = typeof req.body?.senha === "string" ? req.body.senha : "";
  const key = `${req.ip}:${usuario}`;
  const attempt = loginAttempts.get(key) || { count: 0, until: 0 };
  if (attempt.until > Date.now()) return res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos." });
  const db = readDB();
  const user = db.usuarios.find((item) => clean(item.usuario, 80).toLowerCase() === usuario && passwordMatches(String(item.senha || ""), senha));
  if (!user) {
    attempt.count += 1;
    if (attempt.count >= 5) { attempt.count = 0; attempt.until = Date.now() + 5 * 60 * 1000; }
    loginAttempts.set(key, attempt);
    return res.status(401).json({ erro: "Login ou senha inválidos" });
  }
  loginAttempts.delete(key);
  setSession(res, { usuario: user.usuario, tipo: user.tipo });
  res.json({ usuario: user.usuario, tipo: user.tipo });
});

app.post("/logout", (req, res) => {
  const token = req.headers.cookie?.match(/(?:^|; )vg_session=([^;]+)/)?.[1];
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "vg_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/");
  res.status(204).end();
});

app.post("/atendimento", (req, res) => {
  if (!validateText(req.body, [["nome", 120], ["tipo", 40]])) return res.status(400).json({ erro: "Nome e tipo são obrigatórios." });
  const db = readDB();
  const paciente = { id: Date.now(), nome: clean(req.body.nome, 120), cpf: clean(req.body.documento || req.body.cpf, 30), tipo: clean(req.body.tipo, 40), status: "triagem", createdAt: new Date().toISOString() };
  db.pacientes.push(paciente); writeDB(db); res.status(201).json(paciente);
});
app.get("/pacientes", (req, res) => res.json(readDB().pacientes));

app.post("/triagem", (req, res) => {
  if (!validateText(req.body, [["nome", 120], ["sintoma", 200]])) return res.status(400).json({ erro: "Nome e sintoma são obrigatórios." });
  const db = readDB();
  const risco = ["vermelho", "amarelo", "verde", "azul"].includes(req.body.risco) ? req.body.risco : "verde";
  const triagem = { id: Date.now(), nome: clean(req.body.nome, 120), sintoma: clean(req.body.sintoma, 200), temperatura: clean(String(req.body.temperatura ?? ""), 10), pa: clean(req.body.pa, 20), saturacao: clean(String(req.body.saturacao ?? ""), 10), fc: clean(String(req.body.fc ?? ""), 10), dor: clean(String(req.body.dor ?? ""), 10), alergia: clean(req.body.alergia, 200), observacao: clean(req.body.observacao, 500), risco, status: "aguardando_medico", createdAt: new Date().toISOString() };
  db.triagens.push(triagem);
  const paciente = db.pacientes.find((item) => item.nome?.toLowerCase() === triagem.nome.toLowerCase());
  if (paciente) paciente.status = "aguardando_medico";
  writeDB(db); res.status(201).json(triagem);
});
app.get("/triagens", (req, res) => res.json(readDB().triagens));

app.post("/api/analisar-ia", async (req, res) => {
  const fields = ["nome", "sintoma", "temperatura", "pa", "saturacao", "fc", "dor", "observacao"];
  const prompt = `Analise clinicamente os dados abaixo para triagem. Retorne somente JSON com risco e justificativa. Dados: ${fields.map((field) => `${field}: ${clean(String(req.body?.[field] ?? "N/A"), 200)}`).join("; ")}`;
  try {
    const response = await fetch("http://localhost:11434/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "llama3", prompt, stream: false, format: "json" }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("IA indisponível");
    const result = JSON.parse((await response.json()).response);
    if (!["vermelho", "amarelo", "verde", "azul"].includes(result.risco)) throw new Error("Resposta inválida");
    res.json({ risco: result.risco, justificativa: clean(result.justificativa, 500) });
  } catch (error) { res.status(503).json({ erro: "Análise automática indisponível. Faça a triagem manual." }); }
});

app.post("/tv/chamar", requireAuth, (req, res) => {
  const db = readDB();
  const chamada = { id: id(), localTipo: clean(req.body.localTipo, 40), localNumero: clean(req.body.localNumero, 10), paciente: clean(req.body.paciente, 120), hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) };
  db.tv_chamada = chamada; db.tv_historico.unshift(chamada); db.tv_historico = db.tv_historico.slice(0, 5); writeDB(db); res.json(chamada);
});
app.get("/tv/chamada", (req, res) => res.json({ chamada: readDB().tv_chamada, historico: readDB().tv_historico }));
app.get("/lista-medicacoes", requireAuth, (req, res) => res.json(["Dipirona", "Paracetamol", "Ibuprofeno", "Amoxicilina", "Azitromicina", "Loratadina", "Omeprazol", "Buscopan", "Dramin", "Soro Fisiológico"]));
app.post("/consulta", (req, res) => {
  if (!validateText(req.body, [["paciente", 120]])) return res.status(400).json({ erro: "Paciente é obrigatório." });
  const db = readDB(); const consulta = { id: Date.now(), paciente: clean(req.body.paciente, 120), diagnostico: clean(req.body.diagnostico, 500), medicacao: clean(req.body.medicacao, 200), obs: clean(req.body.obs, 500), createdAt: new Date().toISOString() };
  db.consultas.push(consulta); const paciente = db.pacientes.find((item) => item.nome?.toLowerCase() === consulta.paciente.toLowerCase()); if (paciente) paciente.status = "alta"; writeDB(db); res.status(201).json(consulta);
});
app.get("/medicacoes", (req, res) => res.json(readDB().consultas));
app.use((error, req, res, next) => { if (error instanceof SyntaxError) return res.status(400).json({ erro: "JSON inválido." }); res.status(500).json({ erro: "Erro interno do servidor." }); });

module.exports = app;
