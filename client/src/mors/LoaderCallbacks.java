package mors;

import java.awt.Graphics;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.awt.event.MouseWheelEvent;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;
import net.runelite.api.Client;
import net.runelite.api.MainBufferProvider;
import net.runelite.api.Renderable;
import net.runelite.api.events.ChatMessage;
import net.runelite.api.hooks.Callbacks;
import net.runelite.api.widgets.Widget;
import net.runelite.api.widgets.WidgetItem;

/** Minimal stand-in for RuneLite's Hooks: present frames, run queued client-thread tasks, feed events to the bridge. */
public class LoaderCallbacks implements Callbacks
{
	static final ConcurrentLinkedQueue<Runnable> clientThreadTasks = new ConcurrentLinkedQueue<>();
	private final Client client;
	private boolean serverTick;

	LoaderCallbacks(Client client)
	{
		this.client = client;
	}

	@Override
	public void post(Object event)
	{
		if (event instanceof ChatMessage) Bridge.onChat((ChatMessage) event);
	}

	@Override
	public void postDeferred(Object event)
	{
		post(event);
	}

	@Override
	public void tick()
	{
		if (serverTick)
		{
			serverTick = false;
			client.setTickCount(client.getTickCount() + 1);
		}
		Runnable r;
		while ((r = clientThreadTasks.poll()) != null) r.run();
	}

	@Override
	public void serverTick()
	{
		serverTick = true;
	}

	@Override
	public void draw(MainBufferProvider mbp, Graphics graphics, int x, int y)
	{
		java.awt.Graphics2D g = (java.awt.Graphics2D) mbp.getImage().getGraphics();
		try
		{
			AgentOverlay.paint(g); // agent cursor + target outline, baked into the frame
		}
		catch (RuntimeException e)
		{
			e.printStackTrace(); // a broken overlay must never take the game down with it
		}
		g.dispose();
		if (graphics != null) graphics.drawImage(mbp.getImage(), 0, 0, client.getCanvas());
		GatewayLink.frame(mbp.getImage());
	}

	@Override public void tickEnd() {}
	@Override public void frame() {}
	@Override public void drawScene() {}
	@Override public void drawAboveOverheads() {}
	@Override public void drawInterface(int interfaceId, List<WidgetItem> widgetItems) {}
	@Override public void drawLayer(Widget layer, List<WidgetItem> widgetItems) {}
	@Override public MouseEvent mousePressed(MouseEvent e) { return e; }
	@Override public MouseEvent mouseReleased(MouseEvent e) { return e; }
	@Override public MouseEvent mouseClicked(MouseEvent e) { return e; }
	@Override public MouseEvent mouseEntered(MouseEvent e) { return e; }
	@Override public MouseEvent mouseExited(MouseEvent e) { return e; }
	@Override public MouseEvent mouseDragged(MouseEvent e) { return e; }
	@Override public MouseEvent mouseMoved(MouseEvent e) { return e; }
	@Override public MouseWheelEvent mouseWheelMoved(MouseWheelEvent e) { return e; }
	@Override public void keyPressed(KeyEvent e) {}
	@Override public void keyReleased(KeyEvent e) {}
	@Override public void keyTyped(KeyEvent e) {}
	@Override public boolean draw(Renderable renderable, boolean drawingUi) { return true; }
	@Override public void error(String message, Throwable reason) { System.err.println(message); if (reason != null) reason.printStackTrace(); }
	@Override public void openUrl(String url) {}
	@Override public boolean isRuneLiteClientOutdated() { return false; }
}
