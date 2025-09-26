const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const USERS_FILE = path.join(__dirname, "users.json");
const CHATS_FILE = path.join(__dirname, "chats.json");

// --- Funções para ler e escrever nos arquivos ---

const readDataFromFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8");
      if (data) {
        return JSON.parse(data);
      }
    }
  } catch (error) {
    console.error(`Erro ao ler o arquivo ${filePath}:`, error);
  }
  return {};
};

const writeDataToFile = (filePath, data) => {
  fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
    if (err) {
      console.error(`Erro ao salvar o arquivo ${filePath}:`, err);
    }
  });
};

const io = socketIo(server, {
  cors: {
    origin: "https://my-lua-games.vercel.app",
    methods: ["GET", "POST"],
  },
});

let allUsers = readDataFromFile(USERS_FILE);
let chatHistories = readDataFromFile(CHATS_FILE);

const onlineUsers = {};

app.use(express.json());

app.post("/api/register", (req, res) => {
  const { id, username } = req.body;
  if (!id || !username) {
    return res.status(400).json({ message: "ID e username são obrigatórios." });
  }

  if (!allUsers[id]) {
    allUsers[id] = {
      id,
      username,
      friends: [],
    };
    writeDataToFile(USERS_FILE, allUsers);
    console.log(`[API] Novo usuário registrado: ${username} (${id})`);
  } else {
    if (allUsers[id].username !== username) {
      allUsers[id].username = username;
      writeDataToFile(USERS_FILE, allUsers);
    }
    console.log(`[API] Usuário ${username} (${id}) fez login.`);
  }

  res.status(200).json(allUsers[id]);
});

app.get("/api/users", (req, res) => {
  const usersList = Object.values(allUsers).map((user) => {
    return {
      ...user,
      status: onlineUsers.hasOwnProperty(user.id) ? "online" : "offline",
    };
  });
  res.json(usersList);
});

io.on("connection", (socket) => {
  console.log(`[SOCKET] Novo cliente conectado: ${socket.id}`);

  socket.on("userGoesOnline", (userId) => {
    if (userId) {
      onlineUsers[userId] = socket.id;
      socket.userId = userId;
      console.log(
        `[SOCKET] Usuário ${userId}-${allUsers[userId].username} está online com o socket ${socket.id}`
      );
      io.emit("userStatusUpdate", { userId, status: "online" });
    }
  });

  socket.on("requestChatHistory", ({ targetUserId }) => {
    const senderId = socket.userId;
    if (!senderId) return;

    const chatId = [senderId, targetUserId].sort().join("-");
    const history = chatHistories[chatId] || [];
    socket.emit("chatHistory", { friendId: targetUserId, history });
  });

  socket.on("privateMessage", ({ targetUserId, message }) => {
    const senderId = socket.userId;
    if (!senderId) {
      return socket.emit("chatError", "Usuário não autenticado.");
    }
    if (!allUsers[targetUserId]) {
      return socket.emit("chatError", `Usuário '${targetUserId}' não existe.`);
    }

    const messageData = {
      senderId: senderId,
      text: message,
      timestamp: Date.now(),
    };

    const chatId = [senderId, targetUserId].sort().join("-");
    if (!chatHistories[chatId]) {
      chatHistories[chatId] = [];
    }
    chatHistories[chatId].push(messageData);

    writeDataToFile(CHATS_FILE, chatHistories);

    socket.emit("privateMessageReceived", {
      friendId: targetUserId,
      message: messageData,
    });

    const targetSocketId = onlineUsers[targetUserId];
    if (targetSocketId) {
      io.to(targetSocketId).emit("privateMessageReceived", {
        friendId: senderId,
        message: messageData,
      });
    } else {
      console.log(
        `[SOCKET] Usuário '${targetUserId}' offline. Mensagem armazenada.`
      );
    }
  });

  socket.on("disconnect", () => {
    const disconnectedUserId = socket.userId;
    if (disconnectedUserId && onlineUsers[disconnectedUserId] === socket.id) {
      delete onlineUsers[disconnectedUserId];
      console.log(`[SOCKET] Usuário ${disconnectedUserId} ficou offline.`);
      io.emit("userStatusUpdate", {
        userId: disconnectedUserId,
        status: "offline",
      });
    }
    console.log(`[SOCKET] Cliente desconectado: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Servidor de chat Socket.IO escutando na porta ${PORT}`);
});
