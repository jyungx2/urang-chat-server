/**
 * 새로운 메시지를 기반으로 chatRooms 컬렉션을 갱신합니다.
 * 존재하지 않으면 생성 (insert), 이미 있다면 업데이트 (update) —> upsert
 */
export async function upsertChatRoom(
  collection,
  message,
  product,
  buyer,
  seller
) {
  const { roomId, text, createdAt } = message;

  const [productId, sellerId, buyerId] = roomId.split("_");

  await collection.updateOne(
    { roomId }, // 찾을 조건
    {
      $set: {
        lastMessage: text,
        lastMessageAt: new Date(createdAt),
      },
      $setOnInsert: {
        // 문서가 존재하지 않아 새로 생성되는 경우에만 한 번 저장되는 값들
        roomId,
        productId,
        productTitle: product?.title,
        productThumbnail: product?.productImage || null,
        price: product?.type === "Sale" ? product?.price : "free",

        sellerId,
        sellerNickname: seller?.nickname || "",
        sellerImage: product?.writerImage,

        buyerId,
        buyerNickname: buyer?.nickname || "",
        buyerImage: buyer?.profileImage || null,

        location: product?.location || "",
      },
    },
    { upsert: true } // 🔥 이게 핵심! insert or update 둘 다 가능하게 함 (해당 roomId 기준으로 없으면 insert / 있으면 update => "upsert")
  );
}
