const { supabase } = require("./db");

//user
export async function createUser(user) {
  try {
    const { data: existingUsers, error: selectError } = await supabase
      .from("users")
      .select("id")
      .eq("id", user.id);

    if (selectError) throw selectError;

    if (existingUsers.length === 0) {
      const { error: insertError } = await supabase.from("users").insert([
        {
          id: user.id,
          name: user.name,
          password: user.password,
        },
      ]);
      if (insertError) throw insertError;
    }
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
  }
}

export async function editUser(user) {
  try {
    const { error } = await supabase
      .from("users")
      .update({ name: user.name, password: user.password })
      .eq("id", user.id);
    if (error) throw error;
  } catch (error) {
    console.error("Erro ao editar usuário:", error);
  }
}

export async function removeUser(userId) {
  try {
    const { error } = await supabase.from("users").delete().eq("id", userId);
    if (error) throw error;
    await removeUserMessages(userId);
    await removeUserChats(userId);
    await removeUserFriends(userId);
  } catch (error) {
    console.error("Erro ao remover usuário:", error);
  }
}

export async function getAllUsers() {
  try {
    const { data: users, error } = await supabase.from("users").select("*");
    if (error) throw error;
    return users;
  } catch (error) {
    console.error("Erro ao buscar usuários:", error);
    return [];
  }
}

//chat
export async function createChat(chat) {
  try {
    const { data: existingChat, error: selectError } = await supabase
      .from("chats")
      .select("*")
      .eq("id", chat.id)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      throw selectError;
    }

    if (!existingChat) {
      const { error: insertError } = await supabase.from("chats").insert([
        {
          id: chat.id,
          users: chat.users,
          isPrivate: chat.isPrivate || false,
        },
      ]);
      if (insertError) throw insertError;
    }
  } catch (error) {
    console.error("Erro ao criar chat:", error);
  }
}

export async function getChatMessages(chatId) {
  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("chatId", chatId)
      .order("timestamp", { ascending: true });
    if (error) throw error;
    return messages;
  } catch (error) {
    console.error("Erro ao buscar mensagens do chat:", error);
    return [];
  }
}

export async function getAllChats() {
  try {
    const { data: chats, error } = await supabase.from("chats").select("*");
    if (error) throw error;
    return chats;
  } catch (error) {
    console.error("Erro ao buscar chats:", error);
    return [];
  }
}

export async function getAllChatUser(userId) {
  try {
    const { data: chats, error } = await supabase
      .from("chats")
      .select("*")
      .or(`users.cs.{${userId}},isPrivate.eq.false`);
    if (error) throw error;
    return chats;
  } catch (error) {
    console.error("Erro ao buscar chats do usuário:", error);
    return [];
  }
}

export async function removeMessages(chatId, messageId, userId) {
  try {
    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("chatId", chatId)
      .eq("id", messageId)
      .eq("userId", userId);
    if (error) throw error;
  } catch (error) {
    console.error("Erro ao remover mensagem:", error);
  }
}

export async function removeChat(chatId) {
  try {
    const { error } = await supabase.from("chats").delete().eq("id", chatId);
    if (error) throw error;
    await removeChatMessages(chatId);
  } catch (error) {
    console.error("Erro ao remover chat:", error);
  }
}

//friend
export async function getAllFriends() {
  try {
    const { data: friends, error } = await supabase.from("friends").select("*");
    if (error) throw error;
    return friends;
  } catch (error) {
    console.error("Erro ao buscar amigos:", error);
    return [];
  }
}

export async function getUserFriends(userId) {
  try {
    const { data: friends, error } = await supabase
      .from("friends")
      .select("*")
      .eq("userId", userId);
    if (error) throw error;
    return friends;
  } catch (error) {
    console.error("Erro ao buscar amigos do usuário:", error);
    return [];
  }
}

export async function addFriend(friend) {
  try {
    const { data: existingFriend, error: selectError } = await supabase
      .from("friends")
      .select("*")
      .eq("userId", friend.userId)
      .eq("friendId", friend.friendId)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      throw selectError;
    }

    if (!existingFriend) {
      const { error: insertError } = await supabase.from("friends").insert([
        {
          userId: friend.userId,
          friendId: friend.friendId,
        },
      ]);
      if (insertError) throw insertError;
    }
  } catch (error) {
    console.error("Erro ao adicionar amigo:", error);
  }
}

export async function removeFriend(friend) {
  try {
    const { error } = await supabase
      .from("friends")
      .delete()
      .eq("userId", friend.userId)
      .eq("friendId", friend.friendId);
    if (error) throw error;
  } catch (error) {
    console.error("Erro ao remover amigo:", error);
  }
}

//authentication
export async function authenticateUser(id, password) {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", id)
      .eq("password", password)
      .single();
    if (error) throw error;

    const token = Buffer.from(`${id}:${password}`).toString("base64");
    const userToken = await updateToken(id, token);

    user.token = userToken;

    return user;
  } catch (error) {
    console.error("Erro na autenticação do usuário:", error);
    return null;
  }
}

export async function updateToken(userId, token) {
  try {
    const { error } = await supabase
      .from("users")
      .update({ token: token })
      .eq("id", userId);
    if (error) throw error;
  } catch (error) {
    console.error("Erro ao adicionar token:", error);
  }
}

export async function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, "base64").toString("ascii");
    const [id, password] = decoded.split(":");
    const user = await authenticateUser(id, password);
    return user;
  } catch (error) {
    console.error("Erro na verificação do token:", error);
    return null;
  }
}
