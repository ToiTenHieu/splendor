# Splendor (bản chơi riêng với bạn bè, phi thương mại)

Chạy: bấm đúp `start.bat` (hoặc `node server.js`). Không cần cài thư viện nào, chỉ cần Node.js ≥ 18.

- Chơi cùng WiFi/LAN: bạn bè mở link `Cùng WiFi: http://IP:3000` in ra ở cửa sổ server.
- Chơi qua Internet: chạy thêm `cloudflared tunnel --url http://localhost:3000` (hoặc ngrok) rồi gửi link nhận được.
- Tạo phòng -> gửi mã 4 chữ hoặc link -> chủ phòng thêm máy (nếu muốn) và bấm "Bắt đầu ván".
- `node test.js`: cho bot chơi ngẫu nhiên 400 ván để kiểm tra luật. `node test-expansions.js`: kiểm tra từng luật mở rộng và cho bot chơi 1.200 ván với mọi tổ hợp. `node test-i18n.js`: kiểm tra độ đầy đủ của bản dịch Việt/Anh. `node test-bot.js`: 3 kiểu máy chơi 200 ván với nhau.

## Tính năng
- 2–4 người, có thể thêm **máy** (Thương gia / Quý tộc / Tham lam, và **Cao thủ** – mạnh nhất) để đủ người.
  Cao thủ (`mcts.js`) giả lập hàng trăm ván mỗi nước (Monte Carlo, xáo lại bài ẩn nên không nhìn trộm), chạy trong worker riêng (`bot-worker.js`) để không chặn server. Thời gian nghĩ mỗi nước: biến môi trường `BOT_THINK_MS` (mặc định 1500).
  Máy thường biết chặn thẻ đối thủ sắp mua; hệ số trong `bot.js` (W) được tối ưu bằng tự đấu: `node tools/tune-bot.js [số vòng]`.
- **Nhạc nền + âm thanh** kiểu Phục Hưng (tự tổng hợp, kèm vài tiếng gốc BGA), hoạt ảnh thẻ/đá bay, pháo giấy khi thắng. Nút 🎵 🔔 góc dưới phải.
- **Đồng hồ lượt** (chủ phòng chọn 45–180 giây; hết giờ máy đi thay), nút **⏰ Nhắc** người đang suy nghĩ lâu.
- **Chat + emoji**, **lịch sử nước đi**, **bảng thành tích nhóm**, **Ván mới** ngay cùng nhóm.
- **Giao diện song ngữ Việt / English**: chọn ngôn ngữ ở màn tạo phòng hoặc trong sảnh (chủ phòng đổi cho cả phòng). Toàn bộ luật, nhật ký, lỗi, thông báo và tên máy đổi theo ngôn ngữ; mặc định là Tiếng Việt. Chuỗi dịch dùng chung ở `public/i18n.js`.
- **Bộ mở rộng (4 mô-đun)**: chủ phòng bật/tắt từng mô-đun bằng checkbox ở sảnh; có thể bật riêng hoặc kết hợp.
  - **Thành phố**: thay quý tộc bằng 3 thành phố. Đủ điểm và bonus thì nhận thành phố; chiếm thành phố sẽ kết thúc vòng hiện tại, và chỉ người đã có thành phố mới tranh ngôi vô địch.
  - **Thương điếm**: mở 1 trong 5 quyền năng khi đủ bộ bonus, gồm lấy thêm đá sau khi mua, lấy thêm đá khi lấy đôi, vàng đáng gấp đôi, +5 điểm khi có quý tộc, và điểm theo số thương điếm.
  - **Thành trì**: đặt/chuyển/gỡ thành trì để chặn thẻ; 3 thành trì cùng một thẻ cho phép Chinh phục thẻ đó sau hành động.
  - **Phương Đông**: thêm 30 thẻ phát triển (2 thẻ ngửa và một chồng riêng mỗi cấp). Thẻ có thể cho 2 vàng ảo khi mua, sao chép màu bonus, nhận miễn phí một thẻ cấp thấp hơn, giữ riêng quý tộc, hoặc đổi 2 thẻ bonus cùng màu để lấy.
- **Tuỳ chỉnh (nút ⚙️)**: 6 kiểu bàn, 5 bộ bài, chọn ảnh gốc hoặc tranh vẽ, 4 bản nhạc + chỉnh âm lượng. Màn kết quả có bục điểm, biểu đồ theo vòng, danh hiệu, pháo hoa khi thắng.
- Thông báo đến lượt: nhấp nháy tiêu đề, rung điện thoại, 📣 bật thông báo trình duyệt khi ở tab khác.

## Deploy lên Render (miễn phí)
1. Render -> New -> Web Service -> chọn repo này. Build Command để trống, Start Command `node server.js`, gói Free.
2. **Chống ngủ**: Render free ngủ sau 15 phút không ai vào. Server tự gọi chính nó khi đang có phòng hoạt động; ngoài ra có thể tạo monitor miễn phí ở UptimeRobot trỏ tới `https://<app>.onrender.com/health` (mỗi 5 phút).
3. **Không mất ván khi server khởi động lại**: tạo database Redis miễn phí ở upstash.com, rồi trong Render -> Environment thêm 2 biến
   `UPSTASH_REDIS_REST_URL` và `UPSTASH_REDIS_REST_TOKEN` (lấy ở tab REST API của database). Không có 2 biến này thì lưu file `data/rooms.json` (chỉ hữu ích khi chạy ở máy mình, vì Render free xoá đĩa mỗi lần restart).

Dữ liệu: 90 thẻ phát triển gốc (40/30/20) và 10 quý tộc nằm trong `public/data.js`; 30 thẻ Phương Đông nằm trong `public/orient-data.js`.
Dữ liệu 15 thành phố, 5 thương điếm và luật Thành trì nằm ở đầu `engine.js`.

Ảnh & âm thanh gốc: lấy từ Board Game Arena bằng `node crawl_bga.js` (tải toàn bộ vào `assets_splendor/`, không đưa lên git).
Game chỉ dùng các file đã chép sang `public/bga/`:
- `cards.jpg` — tranh thẻ (lưới 6×6: hàng = màu lam/đen/đỏ/lục/trắng + mặt sau; cột 1–2 cấp 1, 3–4 cấp 2, 5–6 cấp 3). Điểm/chi phí vẽ đè bằng HTML. Thẻ Phương Đông vẫn dùng tranh SVG.
- `nobles.png` (chân dung quý tộc), `tokens.png` (đá quý), `bg2.jpg` (bàn "Trời lam").
- `splendor_*.mp3` — tiếng đặt đá, quý tộc, đến lượt.
- Ảnh lỗi/thiếu thì game tự dùng tranh SVG; tiếng lỗi thì dùng tiếng tự tổng hợp.
