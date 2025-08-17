/**
 * index.js
 * 단일 Room(‘room1’)에서 실시간 메시지를 주고받는 가장 작은 Socket.io 서버
 * 1) express 로 HTTP 서버 개설
 * 2) socket.io 로 WebSocket 레이어 얹기
 * 3) 클라이언트가 접속하면 자동으로 room1 입장
 * 4) 'sendMessage' 이벤트 수신 → 같은 방 모두에게 'receiveMessage' 브로드캐스트
 */

// CommonJS 문법을 사용 (Node 기본)
// ES Module을 쓰고 싶다면 package.json에 "type": "module" 추가
const express = require("express"); // REST·헬스체크 등을 위한 HTTP 프레임워크
const http = require("http"); // express 위에 직접 소켓 서버를 올리기 위해 사용
const { Server } = require("socket.io"); // Socket.io 핵심 클래스
const cors = require("cors"); // CORS 허용(개발 단계에서 필수)

const app = express();
const server = http.createServer(app); // express 앱 → 순수 HTTP 서버 변환

// (1) CORS 허용 – Next.js(dev: http://localhost:3000)에서 접근할 수 있게 설정
app.use(
  cors({
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true, // 필요 시 쿠키 인증 허용
  })
);

// (2) Socket.io 인스턴스 생성, HTTP 서버에 붙임
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000", // Socket Handshake 단계에서도 CORS 허용
    methods: ["GET", "POST"],
  },
});

// ✅ MongoDB 연결 & 컬렉션 선언
require("dotenv").config(); // .env 읽기 -> Node.js는 기본적으로 .env 파일을 읽지 않기 때문에 dotenv 패키지를 설치하고 .config()를 호출해줘야 .env내용 로드 가능!
const { MongoClient, ObjectId } = require("mongodb");
const { upsertChatRoom } = require("./lib/chat-rooms-util");

let db;
let messagesCollection;
let chatRoomsCollection;

async function initMongo() {
  try {
    const client = await MongoClient.connect(process.env.MONGODB_URI);
    db = client.db(process.env.MONGODB_NAME);
    messagesCollection = db.collection("messages"); // messages 컬렉션
    chatRoomsCollection = db.collection("chatRooms"); // chatRooms 컬렉션

    console.log("✅ MongoDB 연결 완료");
  } catch (err) {
    console.error("❌ MongoDB 연결 실패:", err);
  }
}

initMongo();

// ---------- Socket.io 로직 시작 ----------
io.on("connection", (socket) => {
  console.log(`[🔌] 클라이언트 연결: ${socket.id}`);

  // (3) 클라이언트가 'joinRoom' 이벤트로 roomId를 보낸다
  // const roomId = "room1";
  // socket.join(roomId); // 클라이언트를 room1에 입장시킴
  // console.log(`[🚪] ${socket.id}가 room1에 입장`);
  socket.on("joinRoom", (roomId) => {
    console.log("✅ 룸에 입장: ", roomId);
    socket.join(roomId);
    console.log(`[🚪] ${socket.id} → ${roomId} 입장`);
  });

  /**
   * (4) 클라이언트로부터 "sendMessage" 이벤트 수신
   *     data = { senderId, text, createdAt, etc. }
   */
  socket.on("sendMessage", async (data) => {
    console.log(`[📨] 메시지 수신: ${JSON.stringify(data)}`);

    if (!data.roomId) return; // roomId 없으면 무시

    // const newData = {
    //   localId: data.localId,
    //   roomId: data.roomId,
    //   senderId: data.senderId,
    //   text: data.text,
    //   createdAt: new Date(data.createdAt),
    // };

    // ✅ 메시지를 DB에 저장
    try {
      // 1. 메시지 저장
      const serverData = await messagesCollection.insertOne({
        // localId: data.localId,
        // roomId: data.roomId,
        // senderId: data.senderId,
        // text: data.text,
        ...data,
        createdAt: new Date(data.createdAt),
      });

      // ✅ 로그 찍기 (성공 여부 및 저장된 _id 확인용)
      console.log("✅ 메시지 저장 완료:", serverData);

      // 2. roomId에서 productId, sellerId, buyerId 추출
      const [productId, sellerId, buyerId] = data.roomId.split("_");

      // 2-1. 상품 정보 가져오기 (chatRooms에 넣을 용도)
      const product = await db
        .collection("products")
        .findOne({ _id: new ObjectId(productId) });
      console.log("🚧", product);

      // 2-2. 유저 정보 가져오기
      const buyer = await db
        .collection("users")
        .findOne({ _id: new ObjectId(buyerId) });
      const seller = await db
        .collection("users")
        .findOne({ _id: new ObjectId(sellerId) });

      console.log("🍎product:", product);
      console.log("🍎buyer:", buyer);
      console.log("🍎seller:", seller);

      // 3. chatRooms 갱신 (upsert)
      await upsertChatRoom(chatRoomsCollection, data, product, buyer, seller);

      // 💥MongoDB에서 삽입된 도큐먼트의 _id를 가져와서 포함
      const fullMessage = {
        ...data,
        _id: serverData.insertedId, // ← 이걸 반드시 포함!
      };

      // 4. 같은 방(roomId)에 있는 모든 소켓에게 메시지 전달
      io.to(data.roomId).emit("receiveMessage", fullMessage);
    } catch (err) {
      console.error("❌ DB insert 실패!", err);
    }
  });

  // (5) 연결 해제 시 로그
  socket.on("disconnect", () => {
    console.log(`[❌] 연결 종료: ${socket.id}`);
  });
});
// ---------- Socket.io 로직 끝 ----------

// (6) 헬스체크 라우트 – 브라우저에서 GET / 로 동작 확인용
app.get("/", (req, res) => res.send("🟢 Socket.io server is running"));

// (7) 서버 실행
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Socket.io 서버 작동 중!  →  http://localhost:${PORT}`);
});
