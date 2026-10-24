const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

// Servir os arquivos estáticos do front-end
app.use(express.static(path.join(__dirname, "../frontend")));

const DB_FILE = path.join(__dirname, "db.json");

function readDB() {
  const defaultDB = {
    usuarios: [],
    pacientes: [],
    triagens: [],
    consultas: [],
    tv_chamada: null,
    tv_historico: []
  };

  if (!fs.existsSync(DB_FILE)) {
    writeDB(defaultDB);
    return defaultDB;
  }

  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
    if (!db.usuarios) db.usuarios = [];
    if (!db.pacientes) db.pacientes = [];
    if (!db.triagens) db.triagens = [];
    if (!db.consultas) db.consultas = [];
    if (!db.tv_chamada) db.tv_chamada = null;
    if (!db.tv_historico) db.tv_historico = [];
    return db;
  } catch (error) {
    console.error("Erro ao ler db.json, recriando estrutura:", error);
    writeDB(defaultDB);
    return defaultDB;
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Erro ao escrever no db.json:", error);
  }
}

// LOGIN
app.post("/login", (req, res) => {
  const db = readDB();
  const user = db.usuarios.find(u =>
    u.usuario === req.body.usuario &&
    u.senha === req.body.senha
  );

  if (!user) {
    return res.status(401).json({ erro: "Login inválido" });
  }

  res.json(user);
});

// ATENDIMENTO - cadastrar paciente
app.post("/atendimento", (req, res) => {
  const db = readDB();

  const paciente = {
    id: Date.now(),
    nome: req.body.nome,
    cpf: req.body.cpf,
    tipo: req.body.tipo,
    status: "triagem",
    createdAt: new Date().toISOString()
  };

  db.pacientes.push(paciente);
  writeDB(db);

  res.json(paciente);
});

// LISTAR PACIENTES
app.get("/pacientes", (req, res) => {
  const db = readDB();
  res.json(db.pacientes);
});

// TRIAGEM
app.post("/triagem", (req, res) => {
  const db = readDB();
  let risco = req.body.risco || "verde";

  const triagem = {
    id: Date.now(),
    nome: req.body.nome,
    sintoma: req.body.sintoma,
    temperatura: req.body.temperatura,
    pa: req.body.pa,
    saturacao: req.body.saturacao,
    fc: req.body.fc,
    dor: req.body.dor,
    alergia: req.body.alergia,
    observacao: req.body.observacao,
    risco,
    status: "aguardando_medico",
    createdAt: new Date().toISOString()
  };

  db.triagens.push(triagem);

  const pacienteFila = db.pacientes.find(p => p.nome && p.nome.toLowerCase() === req.body.nome.toLowerCase());
  if (pacienteFila) {
    pacienteFila.status = "aguardando_medico";
  }

  writeDB(db);
  res.json(triagem);
});

// LISTAR TRIAGENS
app.get("/triagens", (req, res) => {
  const db = readDB();
  res.json(db.triagens);
});

// ============ ROTA DE ANÁLISE POR IA ============
app.post("/api/analisar-ia", async (req, res) => {
  const { nome, sintoma, temperatura, pa, saturacao, fc, dor, observacao } = req.body;

  const prompt = `
    Você é um assistente médico especialista no Protocolo de Manchester para triagem hospitalar.
    Analise os dados clínicos do paciente e classifique o risco.

    Dados do Paciente:
    - Nome: ${nome || 'Não informado'}
    - Sintoma Principal: ${sintoma || 'Não informado'}
    - Temperatura: ${temperatura || 'N/A'} °C
    - Pressão Arterial: ${pa || 'N/A'}
    - Saturação O2: ${saturacao || 'N/A'}%
    - Frequência Cardíaca: ${fc || 'N/A'} BPM
    - Escala de Dor: ${dor || '0'}/10
    - Observações: ${observacao || 'Nenhuma'}

    Responda APENAS um JSON válido sem marcações markdown contendo exatamente as chaves:
    {
      "risco": "vermelho" | "amarelo" | "verde" | "azul",
      "justificativa": "Resumo clínico sucinto explicando o motivo da classificação."
    }
  `;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3',
        prompt: prompt,
        stream: false,
        format: 'json'
      })
    });

    if (!response.ok) throw new Error("Ollama indisponível");

    const data = await response.json();
    const resultado = JSON.parse(data.response);
    res.json(resultado);
  } catch (error) {
    console.warn("Aviso: Ollama offline no ambiente de nuvem. Usando fallback padrão.");
    // Fallback caso o Ollama não esteja rodando no servidor em nuvem (Render)
    res.json({
      risco: "verde",
      justificativa: "Classificação padrão aplicada (Servidor de IA local desconectado no Render)."
    });
  }
});

// ============ MÍDIA INDOOR - TV ============
app.post("/tv/chamar", (req, res) => {
  const db = readDB();

  const chamada = {
    id: Date.now().toString(),
    localTipo: req.body.localTipo,
    localNumero: req.body.localNumero,
    paciente: req.body.paciente,
    hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  };

  db.tv_chamada = chamada;
  db.tv_historico.unshift(chamada);
  if (db.tv_historico.length > 5) db.tv_historico.pop();

  writeDB(db);
  res.json(chamada);
});

app.get("/tv/chamada", (req, res) => {
  const db = readDB();
  res.json({
    chamada: db.tv_chamada,
    historico: db.tv_historico
  });
});

// LISTA DE MEDICAÇÕES
app.get("/lista-medicacoes", (req, res) => {
  res.json([
    "Dipirona",
    "Paracetamol",
    "Ibuprofeno",
    "Amoxicilina",
    "Azitromicina",
    "Loratadina",
    "Omeprazol",
    "Buscopan",
    "Dramin",
    "Soro fisiológico"
  ]);
});

// CONSULTA
app.post("/consulta", (req, res) => {
  const db = readDB();

  const consulta = {
    id: Date.now(),
    paciente: req.body.paciente,
    diagnostico: req.body.diagnostico,
    medicacao: req.body.medicacao,
    obs: req.body.obs,
    createdAt: new Date().toISOString()
  };

  db.consultas.push(consulta);
  writeDB(db);

  res.json(consulta);
});

// MEDICAÇÕES
app.get("/medicacoes", (req, res) => {
  const db = readDB();
  res.json(db.consultas);
});

// START - Dinâmico para aceitar a porta do Render e fallback para 3000 localmente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏥 Hospital Pro rodando na porta ${PORT}`);
});
