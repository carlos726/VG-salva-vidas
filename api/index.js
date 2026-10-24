const path = require("path");
const express = require("express");
const app = require("../backend/app");

app.use(express.static(path.join(__dirname, "../frontend")));

module.exports = app;
