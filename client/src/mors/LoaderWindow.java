package mors;

import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.lang.reflect.Field;
import javax.swing.JFrame;
import net.runelite.api.Client;
import net.runelite.api.hooks.Callbacks;

/** osrs-loader's LoaderWindow: instantiate the client, wire our callbacks, add it to a frame. */
public class LoaderWindow extends JFrame
{
	public static Client client;

	public LoaderWindow(ClientStub stub) throws Exception
	{
		setTitle("MoRS");
		setDefaultCloseOperation(EXIT_ON_CLOSE);
		System.setProperty("jagex.disableBouncyCastle", "true");

		client = (Client) Class.forName(stub.initialClass()).getDeclaredConstructor().newInstance();
		client.setConfiguration(stub);
		// RuneLite fills these @Inject fields with Guice; we provide the same things by type
		java.io.File home = new java.io.File(System.getProperty("user.home"), ".mors");
		home.mkdirs();
		for (Field f : client.getClass().getFields())
		{
			if (java.lang.reflect.Modifier.isStatic(f.getModifiers())) continue;
			if (f.getType() == Callbacks.class) f.set(client, new LoaderCallbacks(client));
			else if (f.getType() == java.util.concurrent.ScheduledExecutorService.class) f.set(client, java.util.concurrent.Executors.newSingleThreadScheduledExecutor());
			else if (f.getType() == java.io.File.class && f.get(client) == null) f.set(client, home);
		}
		// ponytail: initialize() = setSize + init + start, called directly since there is no applet host
		((Component) client).setSize(net.runelite.api.Constants.GAME_FIXED_SIZE);
		client.getClass().getMethod("init").invoke(client);
		client.getClass().getMethod("start").invoke(client);
		System.out.println("[mors] client initialized");

		Component canvas = (Component) client;
		canvas.setPreferredSize(new Dimension(765, 503));
		getContentPane().setLayout(new BorderLayout());
		getContentPane().add(canvas, BorderLayout.CENTER);
		pack();
		setLocationRelativeTo(null);
	}
}
