package mors;

/**
 * Entry point, based on osrs-loader's Boot: parse jav_config, load the client, show it,
 * then expose the Bridge over the gateway WebSocket (-Dmors.gateway=ws://...) or local HTTP.
 * java -cp ... mors.Boot http://127.0.0.1:8888/jav_config.ws
 */
public class Boot
{
	public static void main(String[] args) throws Exception
	{
		String javConfig = args.length > 0 ? args[0] : "http://127.0.0.1:8888/jav_config.ws";
		System.out.println("[mors] boot, jav_config " + javConfig);
		ClientStub stub = new ClientStub(javConfig);
		LoaderWindow window = new LoaderWindow(stub);
		window.setVisible(true);
		if (System.getProperty("mors.gateway") != null)
		{
			GatewayLink.connect(System.getProperty("mors.gateway"));
		}
		else
		{
			Bridge.serveHttp(Integer.getInteger("mors.bridge.port", 7781));
		}
	}
}
