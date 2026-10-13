package mors;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.Polygon;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.util.function.Supplier;

/**
 * Draws what the agent is doing onto every frame: its mouse cursor (with a ripple on click)
 * and the outline + label of the thing it is interacting with. Painted from the client's
 * draw hook, so it shows up in the stream exactly where the game drew the target.
 */
final class AgentOverlay
{
	private static final Color TARGET = new Color(0xff, 0xb0, 0x00);
	private static final Color CURSOR = new Color(0x4f, 0xb6, 0xd6);
	private static final long TARGET_MS = 3500, CLICK_MS = 500;
	private static final Font LABEL_FONT = new Font(Font.SANS_SERIF, Font.BOLD, 12);

	private static volatile int mouseX = -1, mouseY = -1;
	private static volatile long clickAt;
	private static volatile Supplier<Shape> target;
	private static volatile String label;
	private static volatile long targetAt;

	private AgentOverlay()
	{
	}

	static void mouse(int x, int y)
	{
		mouseX = x;
		mouseY = y;
	}

	static void click()
	{
		clickAt = System.currentTimeMillis();
	}

	/** `shape` is re-evaluated every frame on the client thread, so outlines follow moving NPCs and the camera. */
	static void target(Supplier<Shape> shape, String text)
	{
		target = shape;
		label = text;
		targetAt = System.currentTimeMillis();
	}

	static void paint(Graphics2D g)
	{
		long now = System.currentTimeMillis();
		g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
		Supplier<Shape> t = target;
		if (t != null && now - targetAt < TARGET_MS)
		{
			Shape s = null;
			try
			{
				s = t.get();
			}
			catch (RuntimeException ignored)
			{
				// target despawned
			}
			if (s != null)
			{
				float fade = Math.min(1f, 1f - Math.max(0, (now - targetAt - TARGET_MS + 800) / 800f)); // targetAt can land after now (set from another thread)
				g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.18f * fade));
				g.setColor(TARGET);
				g.fill(s);
				g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, Math.max(0.05f, fade)));
				g.setStroke(new BasicStroke(2f));
				g.draw(s);
				drawLabel(g, s.getBounds(), label);
				g.setComposite(AlphaComposite.SrcOver);
			}
		}
		int mx = mouseX, my = mouseY;
		if (mx >= 0)
		{
			long since = Math.max(0, now - clickAt); // clickAt can land after now (set from another thread)
			if (since < CLICK_MS)
			{
				float p = since / (float) CLICK_MS;
				int r = (int) (6 + 18 * p);
				g.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 1f - p));
				g.setColor(CURSOR);
				g.setStroke(new BasicStroke(2.5f));
				g.drawOval(mx - r, my - r, r * 2, r * 2);
				g.setComposite(AlphaComposite.SrcOver);
			}
			Polygon arrow = new Polygon(new int[]{mx, mx, mx + 4, mx + 7, mx + 9, mx + 6, mx + 11}, new int[]{my, my + 15, my + 11, my + 17, my + 16, my + 10, my + 10}, 7);
			g.setColor(Color.BLACK);
			g.setStroke(new BasicStroke(2.5f));
			g.draw(arrow);
			g.setColor(Color.WHITE);
			g.fill(arrow);
			g.setColor(CURSOR);
			g.setStroke(new BasicStroke(1f));
			g.draw(arrow);
		}
	}

	private static void drawLabel(Graphics2D g, Rectangle b, String text)
	{
		if (text == null) return;
		g.setFont(LABEL_FONT);
		FontMetrics fm = g.getFontMetrics();
		int w = fm.stringWidth(text) + 10, h = fm.getHeight() + 2;
		int x = Math.max(2, b.x + b.width / 2 - w / 2), y = Math.max(2, b.y - h - 4);
		g.setColor(new Color(0, 0, 0, 190));
		g.fillRoundRect(x, y, w, h, 6, 6);
		g.setColor(TARGET);
		g.drawRoundRect(x, y, w, h, 6, 6);
		g.drawString(text, x + 5, y + fm.getAscent() + 1);
	}
}
