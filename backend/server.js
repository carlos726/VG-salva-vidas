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

// Função auxiliar para ler o banco de dados com tratamento de erros
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
    const fileContent = fs.readFileSync(DB_FILE, "utf-8");
    const db = JSON.parse(fileContent);

    // Garante que todas as propriedades existam
    if (!db.usuarios) db.usuarios = [];
    if (!db.pacientes) db.pacientes = [];
    if (!db.triagens) db.triagens = [];
    if (!db.consultas) db.consultas = [];
    if (!db.tv_chamada) db.tv_chamada = null;
    if (!db.tv_historico) db.tv_historico = [];

    return db;
  } catch (error) {
    console.error("Erro ao ler db.json, reiniciando estrutura:", error);
    writeDB(defaultDB);
    return defaultDB;
  }
}

// Função auxiliar para salvar o banco de dados
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Erro ao escrever no db.json:", error);
  }
}

// ============ ROTA DE LOGIN ============
app.post("/login", (req, res) => {
  const { usuario, senha } = req.body;
  const db = readDB();

  const user = db.usuarios.find(
    (u) => u.usuario === usuario && u.senha === senha
  );

  if (!user) {
    return res.status(401).json({ erro: "Login ou senha inválidos" });
  }

  res.json(user);
});

// ============ RECEPTIVO / ATENDIMENTO ============
app.post("/atendimento", (req, res) => {
  const db = readDB();

  const paciente = {
    id: Date.now(),
    nome: req.body.nome,
    cpf: req.body.documento,
    tipo: req.body.tipo || "Normal",
    status: "triagem",
    createdAt: new Date().toISOString()
  };

  db.pacientes.push(paciente);
  writeDB(db);

  res.status(201).json(paciente);
});

app.get("/pacientes", (req, res) => {
  const db = readDB();
  res.json(db.pacientes);
});

// ============ TRIAGEM DE PACIENTES ============
app.post("/triagem", (req, res) => {
  const db = readDB();

  const risco = req.body.risco || "verde";

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

  // Atualiza status na fila de pacientes
  const pacienteFila = db.pacientes.find(
    (p) => p.nome && p.nome.toLowerCase() === req.body.nome.toLowerCase()
  );
  if (pacienteFila) {
    pacienteFila.status = "aguardando_medico";
  }

  writeDB(db);
  res.status(201).json(triagem);
});

app.get("/triagens", (req, res) => {
  const db = readDB();
  res.json(db.triagens);
});

// ============ ANÁLISE CLINICA VIA IA (OLLAMA) ============
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
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3",
        prompt: prompt,
        stream: false,
        format: "json"
      })
    });

    if (!response.ok) {
      throw new Error(`Erro no servidor Ollama: ${response.statusText}`);
    }

    const data = await response.json();
    const resultado = JSON.parse(data.response);
    
    res.json(resultado);
  } catch (error) {
    console.error("Erro na comunicação com a IA:", error);
    res.status(500).json({ 
      error: "Erro ao comunicar com a IA do Ollama",
      detalhes: error.message 
    });
  }
});

// ============ SISTEMA DE CHAMADA PARA TV (MÍDIA INDOOR) ============
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

// ============ CONSULTA & MEDICAÇÃO ============
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
    "Soro Fisiológico"
  ]);
});

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

  // Atualiza status do paciente para finalizado/alta
  const paciente = db.pacientes.find(p => p.nome && p.nome.toLowerCase() === req.body.paciente.toLowerCase());
  if (paciente) {
    paciente.status = "alta";
  }

  writeDB(db);
  res.status(201).json(consulta);
});

app.get("/medicacoes", (req, res) => {
  const db = readDB();
  res.json(db.consultas);
});

// ============ INICIALIZAÇÃO DO SERVIDOR ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏥 Hospital Pro rodando na porta ${PORT}: http://localhost:${PORT}`);
});
