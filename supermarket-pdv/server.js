import "dotenv/config";
import express from "express";
import app from "./api/index.js";
app.use(express.static("public"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Supermarket PDV em http://localhost:${port}`));
