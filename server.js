const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "https://my-lua-games.vercel.app",
    methods: ["GET", "POST"],
  },
});

const users = {};

const chatHistories = {};

app.use(express.json());

app.get("/api/friends", (req, res) => {
  const sampleFriends = [
    {
      id: "user1",
      name: "Alice",
      avatar: "https://i.pravatar.cc/150?img=1",
      status: "online",
      game: null,
    },
    {
      id: "user2",
      name: "Bob",
      avatar: "https://i.pravatar.cc/150?img=2",
      status: "offline",
      game: null,
    },
    {
      id: "user3",
      name: "Charlie",
      avatar: "https://i.pravatar.cc/150?img=3",
      status: "online",
      game: "Valorant",
    },
  ];
  res.json(sampleFriends);
});

function getUserIdBySocketId(socketId) {
  for (const userId in users) {
    if (users[userId] === socketId) {
      return userId;
    }
  }
  return null;
}

function getSocketIdByUserId(userId) {
  return users[userId] || null;
}

io.on("connection", (socket) => {
  socket.on("registerUser", (userId) => {
    if (userId && !Object.values(users).includes(socket.id)) {
      for (const key in users) {
        if (users[key] === socket.id) {
          delete users[key];
          break;
        }
      }
      users[userId] = socket.id;
      socket.userId = userId;
      io.emit("userStatusUpdate", { userId: userId, status: "online" });
    } else if (userId && users[userId] !== socket.id) {
      console.warn(
        `[SOCKET] Conflito: Usuário '${userId}' tentou registrar com socket ${socket.id}, mas já está em ${users[userId]}.`
      );
    }
  });

  socket.on("requestChatHistory", ({ userId1, userId2 }) => {
    const chatId = [userId1, userId2].sort().join("-");
    const history = chatHistories[chatId] || [];
    socket.emit("chatHistory", { friendId: userId2, history });
  });

  socket.on("privateMessage", ({ targetUserId, message }) => {
    const senderId = socket.userId;
    if (!senderId) {
      console.warn(
        `[SOCKET] Mensagem privada de socket não registrado: ${socket.id}`
      );
      socket.emit(
        "chatError",
        "Por favor, registre seu ID de usuário primeiro."
      );
      return;
    }

    const targetSocketId = getSocketIdByUserId(targetUserId);

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

    socket.emit("privateMessageReceived", {
      friendId: targetUserId,
      message: messageData,
    });

    if (targetSocketId && targetSocketId !== socket.id) {
      io.to(targetSocketId).emit("privateMessageReceived", {
        friendId: senderId,
        message: messageData,
      });
    } else if (!targetSocketId) {
      console.log(
        `[SOCKET] Usuário '${targetUserId}' offline. Mensagem armazenada.`
      );
      socket.emit(
        "chatError",
        `Usuário '${targetUserId}' está offline. A mensagem será entregue quando ele se conectar.`
      );
    }
  });

  socket.on("disconnect", () => {
    const disconnectedUserId = socket.userId;
    if (disconnectedUserId && users[disconnectedUserId] === socket.id) {
      delete users[disconnectedUserId];
      io.emit("userStatusUpdate", {
        userId: disconnectedUserId,
        status: "offline",
      });
    }
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Servidor de chat Socket.IO escutando na porta ${PORT}`);
});
