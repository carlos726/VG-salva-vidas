const path = require("path");
const app = require("./app");

app.use(require("express").static(path.join(__dirname, "../frontend")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`VG Salva Vidas disponível na porta ${PORT}`);
});
