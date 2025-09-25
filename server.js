const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors"); // Importar o módulo cors

const app = express();
const server = http.createServer(app);

// Configuração do CORS para permitir que o frontend Vue se conecte
const io = socketIo(server, {
  cors: {
    origin: "https://my-lua-games.vercel.app", // Ou a URL específica do seu frontend Vue, por exemplo, "http://localhost:8080"
    methods: ["GET", "POST"],
  },
});

// Armazenar usuários e seus IDs de socket
// { userId: socketId }
const users = {};

// Armazenar históricos de chat temporariamente no servidor (para simulação)
// Em um app real, isso viria de um banco de dados
// { 'chat-id': [{ senderId, message, timestamp }] }
const chatHistories = {};

app.use(express.json()); // Para parsear corpos de requisição JSON

// Endpoint para simular o carregamento de amigos (opcional, mas bom para testar)
app.get("/api/friends", (req, res) => {
  // Isso pode vir de um banco de dados real
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

// Helper para encontrar o userId pelo socketId
function getUserIdBySocketId(socketId) {
  for (const userId in users) {
    if (users[userId] === socketId) {
      return userId;
    }
  }
  return null; // Retorna null se não encontrar
}

// Helper para encontrar o socketId pelo userId
function getSocketIdByUserId(userId) {
  return users[userId] || null;
}

io.on("connection", (socket) => {
  console.log(`[SOCKET] Um usuário se conectou: ${socket.id}`);

  // Evento quando o usuário define seu ID
  socket.on("registerUser", (userId) => {
    if (userId && !Object.values(users).includes(socket.id)) {
      // Verifica se o socket já não está registrado
      // Remove qualquer registro anterior para este socket.id (caso o userId mude ou reconecte)
      for (const key in users) {
        if (users[key] === socket.id) {
          delete users[key];
          console.log(
            `[SOCKET] Removido registro antigo para socket ${socket.id}`
          );
          break;
        }
      }
      users[userId] = socket.id;
      socket.userId = userId; // Armazena o userId diretamente no objeto socket
      console.log(
        `[SOCKET] Usuário '${userId}' registrado com socket ID ${socket.id}`
      );
      io.emit("userStatusUpdate", { userId: userId, status: "online" }); // Informa a todos que este usuário está online
    } else if (userId && users[userId] !== socket.id) {
      // Se o userId já estiver mapeado para outro socket, é um problema de login duplicado ou sessão antiga
      console.warn(
        `[SOCKET] Conflito: Usuário '${userId}' tentou registrar com socket ${socket.id}, mas já está em ${users[userId]}.`
      );
      // Você pode implementar uma lógica aqui para desconectar o socket antigo, etc.
    }
  });

  // Evento para solicitar histórico de chat para um amigo
  socket.on("requestChatHistory", ({ userId1, userId2 }) => {
    const chatId = [userId1, userId2].sort().join("-"); // Cria um ID de chat consistente
    const history = chatHistories[chatId] || [];
    socket.emit("chatHistory", { friendId: userId2, history }); // Envia o histórico para o cliente
    console.log(
      `[SOCKET] Histórico de chat para ${chatId} solicitado por ${userId1}`
    );
  });

  // Escutar por mensagens privadas
  socket.on("privateMessage", ({ targetUserId, message }) => {
    const senderId = socket.userId; // Usamos o userId armazenado no socket
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

    // Salvar no histórico
    const chatId = [senderId, targetUserId].sort().join("-");
    if (!chatHistories[chatId]) {
      chatHistories[chatId] = [];
    }
    chatHistories[chatId].push(messageData);

    // Enviar para o remetente (confirmação ou exibição imediata)
    socket.emit("privateMessageReceived", {
      friendId: targetUserId,
      message: messageData,
    });
    console.log(
      `[SOCKET] Mensagem de '${senderId}' para '${targetUserId}': ${message}`
    );

    // Enviar para o destinatário, se online
    if (targetSocketId && targetSocketId !== socket.id) {
      // Evita enviar para si mesmo duas vezes
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
      // Em um sistema real, você persistiria essa mensagem e a enviaria na próxima conexão do destinatário.
    }
  });

  socket.on("disconnect", () => {
    console.log(`[SOCKET] Usuário desconectado: ${socket.id}`);
    const disconnectedUserId = socket.userId;
    if (disconnectedUserId && users[disconnectedUserId] === socket.id) {
      delete users[disconnectedUserId];
      console.log(
        `[SOCKET] Usuário '${disconnectedUserId}' removido da lista de online.`
      );
      io.emit("userStatusUpdate", {
        userId: disconnectedUserId,
        status: "offline",
      }); // Informa a todos
    }
  });
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`Servidor de chat Socket.IO escutando na porta ${PORT}`);
});

io.on("connection", (socket) => {
  console.log("a user connected");

  socket.on("disconnect", () => {
    console.log("user disconnected");
  });

  // Seus eventos customizados
  socket.on("registerUser", (userId) => {
    /* ... */
  });
  socket.on("privateMessage", (data) => {
    /* ... */
  });
  // etc.
});
