package mors;

import java.awt.Canvas;
import java.awt.Image;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.awt.event.MouseWheelEvent;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import javax.swing.SwingUtilities;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

/**
 * Link to the MoRS gateway: streams game frames (JPEG) to browser viewers,
 * receives their mouse/keyboard input, and answers SDK requests (same "id\npath\nbody" protocol).
 */
public class GatewayLink implements WebSocket.Listener
{
	private static GatewayLink instance;
	private static final long FRAME_INTERVAL_NS = 33_000_000; // ~30 fps

	private final Gson gson = new Gson();
	private final ExecutorService encoder = Executors.newSingleThreadExecutor();
	private final ExecutorService requests = Executors.newSingleThreadExecutor();
	private final AtomicBoolean encoding = new AtomicBoolean();
	private final StringBuilder partial = new StringBuilder();
	private volatile WebSocket ws;
	// java.net.http.WebSocket allows one outstanding send: a reply sent while a frame is still going out fails
	// silently (IllegalStateException in its future) and the gateway waits 30s. Every send goes through here.
	private final Object sendLock = new Object();
	private String url;
	private volatile boolean viewers;
	private long lastFrame;

	public static void connect(String url)
	{
		instance = new GatewayLink();
		instance.open(url);
	}

	private void open(String url)
	{
		this.url = url;
		HttpClient.newHttpClient().newWebSocketBuilder().buildAsync(URI.create(url), this).whenComplete((w, err) -> {
			if (err != null)
			{
				System.err.println("[mors] gateway connect failed, retrying: " + err.getMessage());
				retry(url);
			}
			else
			{
				ws = w;
				System.out.println("[mors] connected to gateway " + url);
			}
		});
	}

	private void retry(String url)
	{
		ws = null;
		new Thread(() -> {
			try
			{
				Thread.sleep(2000);
			}
			catch (InterruptedException ignored)
			{
			}
			open(url);
		}).start();
	}

	/** Called from the client's draw hook every frame; drops frames while the previous one is still encoding. */
	static void frame(Image image)
	{
		GatewayLink g = instance;
		if (g == null || g.ws == null) return;
		long now = System.nanoTime();
		// no viewers: still send one frame every 2s so the gateway always has a fresh screenshot
		if (now - g.lastFrame < (g.viewers ? FRAME_INTERVAL_NS : 2_000_000_000L) || !g.encoding.compareAndSet(false, true)) return;
		g.lastFrame = now;
		BufferedImage src = (BufferedImage) image;
		BufferedImage copy = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_RGB);
		copy.getGraphics().drawImage(src, 0, 0, null);
		g.encoder.submit(() -> {
			try
			{
				byte[] jpg = jpeg(copy);
				synchronized (g.sendLock)
				{
					g.ws.sendBinary(ByteBuffer.wrap(jpg), true).join();
				}
			}
			catch (Exception ignored)
			{
			}
			finally
			{
				g.encoding.set(false);
			}
		});
	}

	private static byte[] jpeg(BufferedImage img) throws Exception
	{
		ImageWriter w = ImageIO.getImageWritersByFormatName("jpeg").next();
		ImageWriteParam p = w.getDefaultWriteParam();
		p.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
		p.setCompressionQuality(0.8f);
		ByteArrayOutputStream bos = new ByteArrayOutputStream(64 * 1024);
		try (MemoryCacheImageOutputStream out = new MemoryCacheImageOutputStream(bos))
		{
			w.setOutput(out);
			w.write(null, new IIOImage(img, null, null), p);
		}
		w.dispose();
		return bos.toByteArray();
	}

	@Override
	public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last)
	{
		partial.append(data);
		if (last)
		{
			String msg = partial.toString();
			partial.setLength(0);
			handle(msg);
		}
		webSocket.request(1);
		return null;
	}

	private void handle(String msg)
	{
		if (msg.startsWith("{"))
		{
			input(gson.fromJson(msg, JsonObject.class));
			return;
		}
		// SDK request: "id\npath\nbody"
		requests.submit(() -> {
			String[] req = msg.split("\n", 3);
			String reply = req[0] + "\n" + Bridge.handle(req[1], req.length > 2 ? req[2] : "");
			synchronized (sendLock)
			{
				ws.sendText(reply, true).join();
			}
		});
	}

	/** Viewer input from the browser canvas, replayed onto the game canvas. */
	private void input(JsonObject e)
	{
		String type = e.get("type").getAsString();
		if (type.equals("viewers"))
		{
			viewers = e.get("count").getAsInt() > 0;
			return;
		}
		Canvas canvas = LoaderWindow.client.getCanvas();
		if (canvas == null) return;
		long now = System.currentTimeMillis();
		SwingUtilities.invokeLater(() -> {
			switch (type)
			{
				case "mousemove":
				case "mousedown":
				case "mouseup":
				{
					int x = e.get("x").getAsInt(), y = e.get("y").getAsInt();
					int button = e.has("button") ? e.get("button").getAsInt() + 1 : 0; // DOM 0/1/2 -> AWT 1/2/3
					int id = type.equals("mousemove") ? (e.has("buttons") && e.get("buttons").getAsInt() > 0 ? MouseEvent.MOUSE_DRAGGED : MouseEvent.MOUSE_MOVED)
						: type.equals("mousedown") ? MouseEvent.MOUSE_PRESSED : MouseEvent.MOUSE_RELEASED;
					int mods = id == MouseEvent.MOUSE_PRESSED || id == MouseEvent.MOUSE_DRAGGED ? InputEvent.getMaskForButton(Math.max(1, button)) : 0;
					canvas.dispatchEvent(new MouseEvent(canvas, id, now, mods, x, y, id == MouseEvent.MOUSE_MOVED || id == MouseEvent.MOUSE_DRAGGED ? 0 : 1, false,
						id == MouseEvent.MOUSE_MOVED || id == MouseEvent.MOUSE_DRAGGED ? MouseEvent.NOBUTTON : button));
					if (id == MouseEvent.MOUSE_RELEASED)
					{
						canvas.dispatchEvent(new MouseEvent(canvas, MouseEvent.MOUSE_CLICKED, now, 0, x, y, 1, false, button));
					}
					break;
				}
				case "wheel":
					canvas.dispatchEvent(new MouseWheelEvent(canvas, MouseEvent.MOUSE_WHEEL, now, 0, e.get("x").getAsInt(), e.get("y").getAsInt(), 0, false,
						MouseWheelEvent.WHEEL_UNIT_SCROLL, 1, e.get("delta").getAsInt()));
					break;
				case "keydown":
				case "keyup":
				{
					int code = e.get("keyCode").getAsInt();
					String key = e.get("key").getAsString();
					char ch = key.length() == 1 ? key.charAt(0) : code == 13 ? '\n' : code == 8 ? '\b' : KeyEvent.CHAR_UNDEFINED;
					int awt = code == 13 ? KeyEvent.VK_ENTER : code == 8 ? KeyEvent.VK_BACK_SPACE : code;
					canvas.dispatchEvent(new KeyEvent(canvas, type.equals("keydown") ? KeyEvent.KEY_PRESSED : KeyEvent.KEY_RELEASED, now, 0, awt, ch));
					if (type.equals("keydown") && ch != KeyEvent.CHAR_UNDEFINED)
					{
						canvas.dispatchEvent(new KeyEvent(canvas, KeyEvent.KEY_TYPED, now, 0, KeyEvent.VK_UNDEFINED, ch));
					}
					break;
				}
			}
		});
	}

	@Override
	public void onError(WebSocket webSocket, Throwable error)
	{
		System.err.println("[mors] gateway error, reconnecting: " + error.getMessage());
		retry(url);
	}

	@Override
	public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason)
	{
		System.err.println("[mors] gateway closed, reconnecting: " + reason);
		retry(url);
		return null;
	}
}
