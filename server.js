const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcrypt");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// shared session between Express & Socket.io
const sess = session({
  secret: "super-secret-change-me",
  resave: false,
  saveUninitialized: false,
});
app.use(sess);

// serve static
app.use(express.static(path.join(__dirname, "public")));

// ---------- in-memory auth state (resets on restart) ----------
/** users: username -> { hash } */
const users = new Map();
/** set of all password hashes to enforce password uniqueness */
const usedPasswordHashes = new Set();

// ---------- auth routes ----------
app.post("/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok:false, msg:"username & password required" });
  if (users.has(username)) return res.status(409).json({ ok:false, msg:"username already exists" });

  const hash = await bcrypt.hash(password, 10);
  if (usedPasswordHashes.has(hash)) return res.status(409).json({ ok:false, msg:"password already in use by another account" });

  users.set(username, { hash });
  usedPasswordHashes.add(hash);
  req.session.user = { username };
  res.json({ ok:true });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const rec = users.get(username);
  if (!rec) return res.status(401).json({ ok:false, msg:"invalid credentials" });
  const ok = await bcrypt.compare(password, rec.hash);
  if (!ok) return res.status(401).json({ ok:false, msg:"invalid credentials" });
  req.session.user = { username };
  res.json({ ok:true });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok:true }));
});

// gate the chat page
app.get("/chat.html", (req, res, next) => {
  if (req.session?.user?.username) return next();
  return res.redirect("/");
});

// ---------- Socket.io + sessions ----------
io.engine.use(sess); // share the same session middleware

// online users: socket.id -> username
const online = new Map();

io.on("connection", (socket) => {
  const username = socket.request.session?.user?.username;
  if (!username) {
    socket.disconnect(true);
    return;
  }

  online.set(socket.id, username);
  io.emit("online:list", Array.from(online.entries()).map(([id,name]) => ({ id, name })));

  socket.on("chat:msg", (text) => {
    if (typeof text !== "string" || !text.trim()) return;
    io.emit("chat:msg", { from: username, text: text.trim(), at: Date.now() });
  });

  // ---- WebRTC signalling to a specific target ----
  socket.on("webrtc:offer", ({ to, offer }) => {
    if (online.has(to)) io.to(to).emit("webrtc:offer", { from: socket.id, name: username, offer });
  });

  socket.on("webrtc:answer", ({ to, answer }) => {
    if (online.has(to)) io.to(to).emit("webrtc:answer", { from: socket.id, answer });
  });

  socket.on("webrtc:ice", ({ to, candidate }) => {
    if (online.has(to)) io.to(to).emit("webrtc:ice", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    online.delete(socket.id);
    io.emit("online:list", Array.from(online.entries()).map(([id,name]) => ({ id, name })));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
