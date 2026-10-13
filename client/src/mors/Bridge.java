package mors;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpServer;
import java.awt.Canvas;
import java.awt.Rectangle;
import java.awt.Shape;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.awt.event.MouseEvent;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import javax.swing.SwingUtilities;
import net.runelite.api.ChatMessageType;
import net.runelite.api.Client;
import net.runelite.api.GameState;
import net.runelite.api.Item;
import net.runelite.api.ItemContainer;
import net.runelite.api.MenuEntry;
import net.runelite.api.NPC;
import net.runelite.api.NPCComposition;
import net.runelite.api.ObjectComposition;
import net.runelite.api.Perspective;
import net.runelite.api.Player;
import net.runelite.api.Point;
import net.runelite.api.Skill;
import net.runelite.api.Tile;
import net.runelite.api.TileItem;
import net.runelite.api.TileObject;
import net.runelite.api.coords.LocalPoint;
import net.runelite.api.coords.WorldPoint;
import net.runelite.api.events.ChatMessage;
import net.runelite.api.gameval.InterfaceID;
import net.runelite.api.gameval.InventoryID;
import net.runelite.api.widgets.Widget;

/**
 * Game state + input over JSON, ported from the RuneLite AgentBridge plugin.
 * Transports: the gateway WebSocket (GatewayLink) or plain HTTP on 127.0.0.1 (serveHttp).
 * Actions hover the target and invoke the client's own menu entry, so the client builds every packet itself.
 */
public class Bridge
{
	private static final int RADIUS = 20;
	private static final Bridge INSTANCE = new Bridge();

	private final Client client = LoaderWindow.client;
	private final Gson gson = new Gson();
	private final Deque<String> messages = new ArrayDeque<>();
	private volatile WorldPoint targetTile; // world tile of the last npc/object picked by interact()
	private volatile Integer targetNpc; // index of the npc picked by interact(), so its menu entry wins over a same-named neighbour

	public static void serveHttp(int port) throws IOException
	{
		HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
		server.setExecutor(Executors.newSingleThreadExecutor()); // ponytail: one request at a time keeps input ordered
		server.createContext("/", ex -> {
			String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
			byte[] out = handle(ex.getRequestURI().getPath(), body).getBytes(StandardCharsets.UTF_8);
			ex.getResponseHeaders().set("Content-Type", "application/json");
			ex.sendResponseHeaders(200, out.length);
			try (OutputStream os = ex.getResponseBody())
			{
				os.write(out);
			}
		});
		server.start();
		System.out.println("MoRS bridge on 127.0.0.1:" + port);
	}

	/** One entry point for both transports: "/state" or "/act" with a JSON body. Always returns JSON. */
	public static synchronized String handle(String path, String body)
	{
		try
		{
			JsonObject r = path.endsWith("/act") ? INSTANCE.act(INSTANCE.gson.fromJson(body, JsonObject.class)) : INSTANCE.onClient(INSTANCE::state);
			return INSTANCE.gson.toJson(r);
		}
		catch (Exception e)
		{
			Throwable c = e.getCause() != null ? e.getCause() : e;
			JsonObject err = new JsonObject();
			err.addProperty("ok", false);
			err.addProperty("error", String.valueOf(c.getMessage()));
			return INSTANCE.gson.toJson(err);
		}
	}

	static void onChat(ChatMessage e)
	{
		INSTANCE.chat(e);
	}

	private void chat(ChatMessage e)
	{
		if (e.getType() == ChatMessageType.GAMEMESSAGE || e.getType() == ChatMessageType.SPAM || e.getType() == ChatMessageType.ENGINE)
		{
			synchronized (messages)
			{
				messages.addLast(removeTags(e.getMessage()));
				while (messages.size() > 15) messages.removeFirst();
			}
		}
	}

	// ---------------------------------------------------------------- state

	private JsonObject state()
	{
		JsonObject s = new JsonObject();
		s.addProperty("gameState", client.getGameState().name());
		s.addProperty("tick", client.getTickCount());
		s.add("ui", chatboxUi());
		if (client.getGameState() != GameState.LOGGED_IN)
		{
			s.addProperty("loginIndex", client.getLoginIndex());
			return s;
		}
		Player me = client.getLocalPlayer();
		WorldPoint pos = me.getWorldLocation();
		JsonObject p = new JsonObject();
		p.addProperty("name", me.getName());
		p.add("pos", point(pos));
		p.addProperty("animation", me.getAnimation());
		p.addProperty("moving", me.getPoseAnimation() != me.getIdlePoseAnimation());
		p.addProperty("interacting", me.getInteracting() != null ? me.getInteracting().getName() : null);
		p.addProperty("hp", client.getBoostedSkillLevel(Skill.HITPOINTS));
		p.addProperty("runEnergy", client.getEnergy() / 100);
		p.addProperty("maxHp", client.getRealSkillLevel(Skill.HITPOINTS));
		p.addProperty("prayer", client.getBoostedSkillLevel(Skill.PRAYER));
		p.addProperty("combatLevel", me.getCombatLevel());
		s.add("player", p);

		JsonObject skills = new JsonObject();
		for (Skill sk : Skill.values())
		{
			skills.addProperty(sk.getName(), client.getRealSkillLevel(sk));
		}
		s.add("skills", skills);
		s.add("inventory", items(client.getItemContainer(InventoryID.INV), true));
		s.add("equipment", items(client.getItemContainer(InventoryID.WORN), false));
		s.addProperty("tutorialProgress", client.getVarpValue(281));
		JsonObject cam = new JsonObject();
		cam.addProperty("yaw", client.getCameraYaw() / JAU); // 0 north, 512 west, 1024 south, 1536 east
		cam.addProperty("pitch", client.getCameraPitch() / JAU); // 128 flat .. 383 top-down
		cam.addProperty("zoom", client.get3dZoom());
		s.add("camera", cam);

		JsonArray npcs = new JsonArray();
		for (NPC n : client.getTopLevelWorldView().npcs())
		{
			NPCComposition c = n.getTransformedComposition();
			if (c == null || n.getName() == null || n.getWorldLocation().distanceTo(pos) > RADIUS) continue;
			JsonObject o = new JsonObject();
			o.addProperty("name", n.getName());
			o.addProperty("index", n.getIndex());
			o.addProperty("id", n.getId());
			o.add("pos", point(n.getWorldLocation()));
			o.addProperty("distance", n.getWorldLocation().distanceTo(pos));
			o.add("actions", actions(c.getActions()));
			o.addProperty("inCombat", n.getHealthRatio() >= 0);
			o.addProperty("interactingWithMe", n.getInteracting() == me);
			npcs.add(o);
		}
		s.add("npcs", npcs);

		JsonArray objects = new JsonArray();
		JsonArray ground = new JsonArray();
		for (Tile t : tilesAround(pos))
		{
			for (TileObject o : tileObjects(t))
			{
				ObjectComposition c = objectDef(o.getId());
				if (c == null || "null".equals(c.getName())) continue;
				// scenery with no menu options (paintings, candles) can still take "use item on": list it, but only close by
				if (actions(c.getActions()).size() == 0 && o.getWorldLocation().distanceTo(pos) > 10) continue;
				JsonObject j = new JsonObject();
				j.addProperty("name", c.getName());
				j.addProperty("id", o.getId());
				j.add("pos", point(o.getWorldLocation()));
				j.addProperty("distance", o.getWorldLocation().distanceTo(pos));
				j.add("actions", actions(c.getActions()));
				objects.add(j);
			}
			if (t.getGroundItems() != null)
			{
				for (TileItem i : t.getGroundItems())
				{
					JsonObject j = new JsonObject();
					j.addProperty("name", client.getItemDefinition(i.getId()).getName());
					j.addProperty("id", i.getId());
					j.addProperty("quantity", i.getQuantity());
					j.add("pos", point(t.getWorldLocation()));
					ground.add(j);
				}
			}
		}
		s.add("objects", objects);
		s.add("groundItems", ground);

		if (client.getHintArrowNpc() != null) s.addProperty("hintArrowNpc", client.getHintArrowNpc().getName());
		if (client.getHintArrowPoint() != null) s.add("hintArrowPoint", point(client.getHintArrowPoint()));
		synchronized (messages)
		{
			s.add("messages", gson.toJsonTree(messages));
		}
		return s;
	}

	/** Visible text and clickable things in the chatbox: dialogue, options, tutorial instructions, prompts. */
	private JsonArray chatboxUi()
	{
		JsonArray out = new JsonArray();
		Widget history = client.getWidget(InterfaceID.Chatbox.CHATDISPLAY);
		walk(client.getWidget(InterfaceID.Chatbox.CHATAREA), history, out);
		walk(client.getWidget(InterfaceID.Chatbox.MES_LAYER), history, out);
		return out;
	}

	private void walk(Widget w, Widget skip, JsonArray out)
	{
		if (w == null || w.isHidden() || w == skip) return;
		String text = w.getText() == null ? "" : removeTags(w.getText()).trim();
		if (!text.isEmpty())
		{
			out.add(text);
		}
		for (Widget[] kids : new Widget[][]{w.getStaticChildren(), w.getDynamicChildren(), w.getNestedChildren()})
		{
			if (kids != null) for (Widget k : kids) walk(k, skip, out);
		}
	}

	// ---------------------------------------------------------------- actions

	private JsonObject act(JsonObject a) throws Exception
	{
		String op = a.get("op").getAsString();
		switch (op)
		{
			case "login":
				onClient(() -> {
					client.setUsername(a.get("username").getAsString());
					client.setPassword(a.get("password").getAsString());
					client.setGameState(GameState.LOGGING_IN);
					return null;
				});
				return ok("logging in");
			case "walk":
				return walk(a.get("x").getAsInt(), a.get("y").getAsInt());
			case "npc":
			case "object":
			case "groundItem":
			case "widget":
				return interact(op, a);
			case "camera":
				return camera(a);
			case "varp": // read-only, e.g. quest progress (29 = Cook's Assistant)
			{
				int id = a.get("id").getAsInt();
				return onClient(() -> {
					JsonObject r = ok("varp " + id + " = " + client.getVarpValue(id));
					r.addProperty("value", client.getVarpValue(id));
					return r;
				});
			}
			case "varbit": // read-only, e.g. quest progress kept in part of a varp (3468 = Misthalin Mystery)
			{
				int id = a.get("id").getAsInt();
				return onClient(() -> {
					JsonObject r = ok("varbit " + id + " = " + client.getVarbitValue(id));
					r.addProperty("value", client.getVarbitValue(id));
					return r;
				});
			}
			case "collision":
				return onClient(() -> collision(a.get("x").getAsInt(), a.get("y").getAsInt(), a.has("radius") ? a.get("radius").getAsInt() : 6));
			case "click":
				click(a.get("x").getAsInt(), a.get("y").getAsInt());
				return ok("clicked " + a.get("x").getAsInt() + "," + a.get("y").getAsInt());
			case "key":
				key(a.get("key").getAsString());
				return ok("pressed " + a.get("key").getAsString());
			case "type":
				// regular-game input only: no server commands (::tele, ::item, ...)
				if (a.get("text").getAsString().trim().startsWith("::")) throw new IllegalArgumentException("server commands are not allowed; play the game normally");
				for (char c : a.get("text").getAsString().toCharArray()) typeChar(c);
				return ok("typed");
			case "menu":
				return onClient(() -> {
					JsonArray arr = new JsonArray();
					for (MenuEntry e : client.getMenuEntries()) arr.add(e.getOption() + " | " + removeTags(e.getTarget()));
					JsonObject r = ok("menu");
					r.add("entries", arr);
					return r;
				});
			default:
				throw new IllegalArgumentException("unknown op " + op);
		}
	}

	/** Hover the named target, then invoke the client's own menu entry for `option`. */
	private JsonObject interact(String kind, JsonObject a) throws Exception
	{
		String name = a.has("name") ? a.get("name").getAsString().toLowerCase() : null;
		if (!a.has("option")) throw new IllegalArgumentException(kind + " needs an option, e.g. \"Talk-to\"");
		String option = a.get("option").getAsString().toLowerCase();
		Integer x = a.has("x") ? a.get("x").getAsInt() : null;
		Integer y = a.has("y") ? a.get("y").getAsInt() : null;
		Integer index = a.has("index") ? a.get("index").getAsInt() : null;
		if (name == null && !kind.equals("widget") && !(kind.equals("npc") && index != null)) throw new IllegalArgumentException(kind + " needs a name");
		targetNpc = null;
		java.util.function.Supplier<Shape> shape = onClient(() -> {
			switch (kind)
			{
				case "npc": return npcBox(name, x, y, index);
				case "object": return objectBox(name, x, y);
				case "groundItem": return groundItemBox(name);
				default: return widgetBox(name, option);
			}
		});
		targetTile = null;
		Integer npcIndex = targetNpc;
		Rectangle box = shape == null ? null : onClient(() -> { Shape sh = shape.get(); return sh == null ? null : sh.getBounds(); });
		if (!kind.equals("widget") && targetTile != null && (box == null || !comfortablyInView(box)))
		{
			humanCamera(targetTile);
			box = shape == null ? null : onClient(() -> { Shape sh = shape.get(); return sh == null ? null : sh.getBounds(); });
		}
		String label = name != null ? name : "npc #" + index;
		if (box == null) throw new IllegalArgumentException(kind + " '" + label + "' not found on screen nearby");
		AgentOverlay.target(shape, a.get("option").getAsString() + (name != null && !name.equals(option) ? " → " + a.get("name").getAsString() : ""));
		// try a few points inside the clickbox; models are not rectangles
		double[][] offsets = {{0, 0}, {0, -.25}, {0, .25}, {-.25, 0}, {.25, 0}};
		for (double[] off : offsets)
		{
			// the menu is rebuilt on the client's next frame, which can take a few hundred ms under load: poll for it,
			// re-aiming each time so a walking NPC doesn't slip out from under the cursor
			for (int wait = 0; wait < 8; wait++)
			{
				Rectangle b = shape == null ? null : onClient(() -> { Shape sh = shape.get(); return sh == null ? null : sh.getBounds(); });
				if (b == null) b = box;
				mouse(MouseEvent.MOUSE_MOVED, (int) (b.getCenterX() + off[0] * b.width), (int) (b.getCenterY() + off[1] * b.height), MouseEvent.NOBUTTON);
				Thread.sleep(60);
				JsonObject r = onClient(() -> invokeEntry(option, kind.equals("widget") ? null : name, npcIndex));
				if (r != null) return r;
			}
		}
		JsonObject err = onClient(() -> {
			JsonObject r = new JsonObject();
			r.addProperty("ok", false);
			r.addProperty("error", "no menu entry '" + option + "' on " + label);
			JsonArray arr = new JsonArray();
			for (MenuEntry e : client.getMenuEntries()) arr.add(e.getOption() + " | " + removeTags(e.getTarget()));
			r.add("menu", arr);
			return r;
		});
		return err;
	}

	private JsonObject invokeEntry(String option, String target, Integer npcIndex)
	{
		MenuEntry[] entries = client.getMenuEntries();
		for (int i = entries.length - 1; i >= 0; i--) // top of the rendered menu first
		{
			MenuEntry e = entries[i];
			String t = removeTags(e.getTarget()).toLowerCase();
			if (!e.getOption().toLowerCase().equals(option)) continue;
			// targets read "Tree", "Man  (level-2)", or "Tin ore -> Furnace" when an item/spell is selected
			String subject = t.contains(" -> ") ? t.substring(t.indexOf(" -> ") + 4) : t;
			if (npcIndex != null) { if (e.getIdentifier() != npcIndex || !e.getType().name().contains("NPC")) continue; } // the picked NPC, even if `name` was only part of its name
			else if (target != null && !subject.equals(target) && !subject.startsWith(target + " ")) continue;
			client.menuAction(e.getParam0(), e.getParam1(), e.getType(), e.getIdentifier(), e.getItemId(), e.getOption(), e.getTarget());
			AgentOverlay.click();
			JsonObject r = ok(e.getOption() + " " + removeTags(e.getTarget()));
			return r;
		}
		return null;
	}

	private java.util.function.Supplier<Shape> npcBox(String name, Integer x, Integer y, Integer index)
	{
		WorldPoint me = client.getLocalPlayer().getWorldLocation();
		NPC best = null;
		targetNpc = null;
		for (NPC n : client.getTopLevelWorldView().npcs())
		{
			if (n.getName() == null || n.getConvexHull() == null) continue;
			if (name != null && !n.getName().toLowerCase().contains(name)) continue; // index alone is enough
			if (index != null && n.getIndex() != index) continue;
			if (x != null && (n.getWorldLocation().getX() != x || n.getWorldLocation().getY() != y)) continue;
			boolean exact = n.getName().equalsIgnoreCase(name), bestExact = best != null && best.getName().equalsIgnoreCase(name);
			if (best == null || (exact && !bestExact) || (exact == bestExact && n.getWorldLocation().distanceTo(me) < best.getWorldLocation().distanceTo(me))) best = n;
		}
		NPC npc = best;
		if (npc != null)
		{
			targetTile = npc.getWorldLocation();
			targetNpc = npc.getIndex();
		}
		return npc == null ? null : npc::getConvexHull;
	}

	private java.util.function.Supplier<Shape> objectBox(String name, Integer x, Integer y)
	{
		WorldPoint me = client.getLocalPlayer().getWorldLocation();
		TileObject best = null;
		for (Tile t : tilesAround(me))
		{
			for (TileObject o : tileObjects(t))
			{
				ObjectComposition c = objectDef(o.getId());
				if (c == null || !c.getName().toLowerCase().contains(name) || o.getClickbox() == null) continue;
				if (x != null && (o.getWorldLocation().getX() != x || o.getWorldLocation().getY() != y)) continue;
				boolean exact = c.getName().equalsIgnoreCase(name), bestExact = best != null && objectDef(best.getId()).getName().equalsIgnoreCase(name);
				if (best == null || (exact && !bestExact) || (exact == bestExact && o.getWorldLocation().distanceTo(me) < best.getWorldLocation().distanceTo(me))) best = o;
			}
		}
		TileObject obj = best;
		if (obj != null) targetTile = obj.getWorldLocation();
		return obj == null ? null : obj::getClickbox;
	}

	private java.util.function.Supplier<Shape> groundItemBox(String name)
	{
		for (Tile t : tilesAround(client.getLocalPlayer().getWorldLocation()))
		{
			if (t.getGroundItems() == null) continue;
			for (TileItem i : t.getGroundItems())
			{
				if (client.getItemDefinition(i.getId()).getName().toLowerCase().contains(name))
				{
					LocalPoint lp = t.getLocalLocation();
					if (Perspective.getCanvasTilePoly(client, lp) != null) return () -> Perspective.getCanvasTilePoly(client, lp);
				}
			}
		}
		return null;
	}

	/** Any visible widget whose text/name matches and which offers `option`. */
	private java.util.function.Supplier<Shape> widgetBox(String name, String option)
	{
		for (Widget root : client.getWidgetRoots())
		{
			Rectangle r = findWidget(root, name, option);
			if (r != null) return () -> r;
		}
		return null;
	}

	private Rectangle findWidget(Widget w, String name, String option)
	{
		if (w == null || w.isHidden()) return null;
		boolean nameMatch = name == null || name.equals(option) // tab stones etc. have only an action
			|| (w.getName() != null && removeTags(w.getName()).toLowerCase().contains(name))
			|| (w.getText() != null && removeTags(w.getText()).toLowerCase().contains(name))
			|| (w.getItemId() > 0 && client.getItemDefinition(w.getItemId()).getName().toLowerCase().contains(name));
		// "Use" on items comes from the target verb, not getActions()
		if (nameMatch && w.getBounds().width > 0 && w.getTargetVerb() != null && removeTags(w.getTargetVerb()).toLowerCase().equals(option))
		{
			return w.getBounds();
		}
		if (nameMatch && w.getActions() != null)
		{
			for (String act : w.getActions())
			{
				if (act != null && removeTags(act).toLowerCase().equals(option) && w.getBounds().width > 0)
				{
					return w.getBounds();
				}
			}
		}
		for (Widget[] kids : new Widget[][]{w.getDynamicChildren(), w.getStaticChildren(), w.getNestedChildren()})
		{
			if (kids == null) continue;
			for (Widget k : kids)
			{
				Rectangle r = findWidget(k, name, option);
				if (r != null) return r;
			}
		}
		return null;
	}

	private JsonObject walk(int x, int y) throws Exception
	{
		java.awt.Point target = onClient(() -> {
			LocalPoint lp = LocalPoint.fromWorld(client.getTopLevelWorldView(), x, y);
			if (lp == null) return null;
			Point p = Perspective.localToCanvas(client, lp, client.getTopLevelWorldView().getPlane());
			// viewport click only when it lands on the game view, not on a side panel
			Widget vp = client.getWidget(InterfaceID.ToplevelOsrsStretch.GAMEFRAME);
			Rectangle view = vp != null ? vp.getBounds() : new Rectangle(0, 0, 512, 334);
			if (p != null && view.contains(p.getX(), p.getY()) && !overSidePanel(p))
			{
				return new java.awt.Point(p.getX(), p.getY());
			}
			Point mm = Perspective.localToMinimap(client, lp);
			return mm == null ? null : new java.awt.Point(mm.getX(), mm.getY());
		});
		if (target == null) throw new IllegalArgumentException("tile " + x + "," + y + " is too far; walk somewhere closer first");
		onClient(() -> { if (client.getCameraPitch() < 300 * JAU) client.setCameraPitchTarget(340 * JAU); return null; });
		LocalPoint dest = onClient(() -> LocalPoint.fromWorld(client.getTopLevelWorldView(), x, y));
		if (dest != null) AgentOverlay.target(() -> Perspective.getCanvasTilePoly(client, dest), "Walk → " + x + ", " + y);
		mouse(MouseEvent.MOUSE_MOVED, target.x, target.y, MouseEvent.NOBUTTON);
		Thread.sleep(40);
		JsonObject r = onClient(() -> invokeEntry("walk here", null, null));
		if (r == null) click(target.x, target.y); // minimap: a plain click walks
		return ok("walking to " + x + "," + y);
	}

	/** A player would only click things near the middle of the 512x334 game view. */
	private static boolean comfortablyInView(Rectangle b)
	{
		double cx = b.getCenterX(), cy = b.getCenterY();
		return cx > 40 && cx < 470 && cy > 30 && cy < 300;
	}

	/** Turn like a person: tilt to a normal high view and swing the camera toward the target (the client animates it). */
	private void humanCamera(WorldPoint tile) throws Exception
	{
		onClient(() -> {
			WorldPoint me = client.getLocalPlayer().getWorldLocation();
			double ang = Math.atan2(-(tile.getX() - me.getX()), tile.getY() - me.getY());
			int yaw = (int) Math.round(((ang / Math.PI) * 1024 + 2048) % 2048);
			client.setCameraYawTarget(yaw * JAU);
			if (client.getCameraPitch() < 300 * JAU) client.setCameraPitchTarget(340 * JAU);
			return null;
		});
		Thread.sleep(700);
	}

	/**
	 * Camera control: {yaw, pitch} absolute targets, {faceX, faceY} turns toward a tile,
	 * {zoom: n} scrolls the mouse wheel n notches (negative = in).
	 */
	private JsonObject camera(JsonObject a) throws Exception
	{
		if (a.has("faceX"))
		{
			int fx = a.get("faceX").getAsInt(), fy = a.get("faceY").getAsInt();
			Integer yaw = onClient(() -> {
				WorldPoint me = client.getLocalPlayer().getWorldLocation();
				double ang = Math.atan2(-(fx - me.getX()), fy - me.getY()); // 0 = north, counter-clockwise
				return (int) Math.round(((ang / Math.PI) * 1024 + 2048) % 2048);
			});
			a.addProperty("yaw", yaw);
		}
		if (a.has("yaw") || a.has("pitch"))
		{
			onClient(() -> {
				if (a.has("yaw")) client.setCameraYawTarget((((a.get("yaw").getAsInt() % 2048) + 2048) % 2048) * JAU);
				if (a.has("pitch")) client.setCameraPitchTarget(Math.max(128, Math.min(383, a.get("pitch").getAsInt())) * JAU);
				return null;
			});
		}
		if (a.has("zoom"))
		{
			int n = a.get("zoom").getAsInt();
			// state.camera.zoom is a level (~100..1400); this is wheel notches, so a level passed here would spin for minutes
			if (Math.abs(n) > 30) throw new IllegalArgumentException("zoom is mouse-wheel notches (-30..30, negative = in), not a zoom level; got " + n);
			Canvas canvas = client.getCanvas();
			for (int i = 0; i < Math.abs(n); i++)
			{
				java.awt.event.MouseWheelEvent e = new java.awt.event.MouseWheelEvent(canvas, MouseEvent.MOUSE_WHEEL, System.currentTimeMillis(), 0,
					256, 167, 0, false, java.awt.event.MouseWheelEvent.WHEEL_UNIT_SCROLL, 1, Integer.signum(n));
				SwingUtilities.invokeAndWait(() -> canvas.dispatchEvent(e));
				Thread.sleep(30);
			}
		}
		Thread.sleep(400);
		return onClient(() -> {
			JsonObject r = ok("camera yaw " + client.getCameraYaw() / JAU + " pitch " + client.getCameraPitch() / JAU + " zoom " + client.get3dZoom());
			return r;
		});
	}

	/** Collision flags around a world tile, as rows (north first) of hex flags. 0 = free. */
	// The camera API is in 14-bit angle units (2048 = a quarter turn) but ours is the classic 11-bit one
	// (0..2047 yaw, 128..383 pitch), so convert at the edge.
	private static final int JAU = 8;

	private JsonObject collision(int cx, int cy, int r)
	{
		net.runelite.api.WorldView wv = client.getTopLevelWorldView();
		int[][] flags = wv.getCollisionMaps()[wv.getPlane()].getFlags();
		JsonArray rows = new JsonArray();
		for (int y = cy + r; y >= cy - r; y--)
		{
			StringBuilder row = new StringBuilder(y + ": ");
			for (int x = cx - r; x <= cx + r; x++)
			{
				int sx = x - wv.getBaseX(), sy = y - wv.getBaseY();
				int f = sx < 0 || sy < 0 || sx >= flags.length || sy >= flags[0].length ? -1 : flags[sx][sy];
				row.append(String.format("%7x ", f & 0xffffff));
			}
			rows.add(row.toString());
		}
		JsonObject o = ok("collision x " + (cx - r) + ".." + (cx + r));
		o.add("rows", rows);
		return o;
	}

	private boolean overSidePanel(Point p)
	{
		Widget inv = client.getWidget(InterfaceID.ToplevelOsrsStretch.SIDE_CONTAINER);
		Widget chat = client.getWidget(InterfaceID.Chatbox.UNIVERSE);
		return (inv != null && !inv.isHidden() && inv.getBounds().contains(p.getX(), p.getY()))
			|| (chat != null && !chat.isHidden() && chat.getBounds().contains(p.getX(), p.getY()));
	}

	// ---------------------------------------------------------------- helpers

	private Iterable<Tile> tilesAround(WorldPoint c)
	{
		java.util.List<Tile> out = new java.util.ArrayList<>();
		Tile[][] plane = client.getTopLevelWorldView().getScene().getTiles()[client.getTopLevelWorldView().getPlane()];
		for (Tile[] col : plane)
		{
			for (Tile t : col)
			{
				if (t != null && t.getWorldLocation().distanceTo(c) <= RADIUS) out.add(t);
			}
		}
		return out;
	}

	private static Iterable<TileObject> tileObjects(Tile t)
	{
		java.util.List<TileObject> out = new java.util.ArrayList<>();
		// multi-tile objects (trees, rocks) sit on several tiles: list each once, from its south-west tile
		if (t.getGameObjects() != null) for (net.runelite.api.GameObject o : t.getGameObjects()) if (o != null && o.getSceneMinLocation().equals(t.getSceneLocation())) out.add(o);
		if (t.getWallObject() != null) out.add(t.getWallObject());
		if (t.getDecorativeObject() != null) out.add(t.getDecorativeObject());
		if (t.getGroundObject() != null) out.add(t.getGroundObject());
		return out;
	}

	private ObjectComposition objectDef(int id)
	{
		ObjectComposition c = client.getObjectDefinition(id);
		if (c != null && c.getImpostorIds() != null) c = c.getImpostor();
		return c;
	}

	private JsonArray items(ItemContainer c, boolean slots)
	{
		JsonArray out = new JsonArray();
		if (c == null) return out;
		Item[] items = c.getItems();
		for (int i = 0; i < items.length; i++)
		{
			if (items[i].getId() <= 0) continue;
			JsonObject j = new JsonObject();
			j.addProperty("name", client.getItemDefinition(items[i].getId()).getName());
			j.addProperty("id", items[i].getId());
			j.addProperty("quantity", items[i].getQuantity());
			if (slots) j.addProperty("slot", i);
			out.add(j);
		}
		return out;
	}

	private static JsonArray actions(String[] actions)
	{
		JsonArray out = new JsonArray();
		if (actions != null) for (String s : actions) if (s != null && !s.isEmpty()) out.add(removeTags(s));
		return out;
	}

	private static JsonObject point(WorldPoint w)
	{
		JsonObject o = new JsonObject();
		o.addProperty("x", w.getX());
		o.addProperty("y", w.getY());
		o.addProperty("plane", w.getPlane());
		return o;
	}

	private static Rectangle bounds(Shape s)
	{
		return s.getBounds();
	}

	private static JsonObject ok(String msg)
	{
		JsonObject o = new JsonObject();
		o.addProperty("ok", true);
		o.addProperty("result", msg);
		return o;
	}

	private <T> T onClient(Supplier<T> fn) throws Exception
	{
		CompletableFuture<T> f = new CompletableFuture<>();
		LoaderCallbacks.clientThreadTasks.add(() -> {
			try
			{
				f.complete(fn.get());
			}
			catch (Throwable t)
			{
				f.completeExceptionally(t);
			}
		});
		return f.get(5, TimeUnit.SECONDS);
	}

	private void click(int x, int y) throws Exception
	{
		mouse(MouseEvent.MOUSE_MOVED, x, y, MouseEvent.NOBUTTON);
		Thread.sleep(30);
		mouse(MouseEvent.MOUSE_PRESSED, x, y, MouseEvent.BUTTON1);
		Thread.sleep(30);
		mouse(MouseEvent.MOUSE_RELEASED, x, y, MouseEvent.BUTTON1);
		mouse(MouseEvent.MOUSE_CLICKED, x, y, MouseEvent.BUTTON1);
	}

	private void mouse(int id, int x, int y, int button) throws Exception
	{
		AgentOverlay.mouse(x, y);
		if (id == MouseEvent.MOUSE_PRESSED) AgentOverlay.click();
		Canvas canvas = client.getCanvas();
		int mods = button != MouseEvent.NOBUTTON && id == MouseEvent.MOUSE_PRESSED ? InputEvent.getMaskForButton(button) : 0;
		MouseEvent e = new MouseEvent(canvas, id, System.currentTimeMillis(), mods, x, y, button == MouseEvent.NOBUTTON ? 0 : 1, false, button);
		SwingUtilities.invokeAndWait(() -> canvas.dispatchEvent(e));
	}

	private void key(String name) throws Exception
	{
		int code;
		switch (name.toLowerCase())
		{
			case "space": code = KeyEvent.VK_SPACE; break;
			case "enter": code = KeyEvent.VK_ENTER; break;
			case "escape": code = KeyEvent.VK_ESCAPE; break;
			case "backspace": code = KeyEvent.VK_BACK_SPACE; break;
			default:
				if (name.length() == 1)
				{
					typeChar(name.charAt(0));
					return;
				}
				code = KeyEvent.class.getField("VK_" + name.toUpperCase()).getInt(null); // F1..F12 etc.
		}
		char ch = code == KeyEvent.VK_SPACE ? ' ' : code == KeyEvent.VK_ENTER ? '\n' : KeyEvent.CHAR_UNDEFINED;
		keyEvents(code, ch);
	}

	private void typeChar(char c) throws Exception
	{
		keyEvents(KeyEvent.getExtendedKeyCodeForChar(c), c);
	}

	private void keyEvents(int code, char ch) throws Exception
	{
		Canvas canvas = client.getCanvas();
		long now = System.currentTimeMillis();
		SwingUtilities.invokeAndWait(() -> {
			canvas.dispatchEvent(new KeyEvent(canvas, KeyEvent.KEY_PRESSED, now, 0, code, ch));
			if (ch != KeyEvent.CHAR_UNDEFINED) canvas.dispatchEvent(new KeyEvent(canvas, KeyEvent.KEY_TYPED, now, 0, KeyEvent.VK_UNDEFINED, ch));
			canvas.dispatchEvent(new KeyEvent(canvas, KeyEvent.KEY_RELEASED, now, 0, code, ch));
		});
		Thread.sleep(15);
	}

	static String removeTags(String s)
	{
		return s == null ? "" : s.replaceAll("<[^>]*>", "");
	}
}
