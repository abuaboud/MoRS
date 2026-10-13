package mors;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.MalformedURLException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import net.runelite.api.ClientConfiguration;

/** osrs-loader's RsAppleStub, for the modern client: jav_config params + codebase. */
public class ClientStub implements ClientConfiguration
{
	private final Map<String, String> params = new HashMap<>();
	private final Map<String, String> config = new HashMap<>();

	public ClientStub(String javConfigUrl) throws IOException
	{
		try (BufferedReader in = new BufferedReader(new InputStreamReader(new URL(javConfigUrl).openStream(), StandardCharsets.UTF_8)))
		{
			String line;
			while ((line = in.readLine()) != null)
			{
				int eq = line.indexOf('=');
				if (eq < 0) continue;
				String key = line.substring(0, eq), value = line.substring(eq + 1);
				if (key.equals("param"))
				{
					int eq2 = value.indexOf('=');
					params.put(value.substring(0, eq2), value.substring(eq2 + 1));
				}
				else if (!key.equals("msg"))
				{
					config.put(key, value);
				}
			}
		}
	}

	public String initialClass()
	{
		return config.getOrDefault("initial_class", "client.class").replace(".class", "");
	}

	@Override
	public URL getCodeBase()
	{
		try
		{
			return new URL(config.get("codebase"));
		}
		catch (MalformedURLException e)
		{
			return null;
		}
	}

	@Override
	public String getParameter(String key)
	{
		return params.get(key);
	}

	@Override
	public void onError(String code)
	{
		System.err.println("client error: " + code);
	}
}
