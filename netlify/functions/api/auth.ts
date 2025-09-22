import type { Context } from "@netlify/functions";

export default async function handler(req: Request, context: Context) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  // Auth0 configuration
  const AUTH0_DOMAIN = process.env.PUBLIC_AUTH0_DOMAIN;
  const AUTH0_CLIENT_ID = process.env.PUBLIC_AUTH0_CLIENT_ID;
  const SITE_URL = process.env.URL || 'https://dev.stamm-phoenix.de';

  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) {
    return new Response("Missing Auth0 configuration", { status: 500 });
  }

  if (action === "login") {
    // Redirect to Auth0 login
    const redirectUri = `${SITE_URL}/api/auth?action=callback`;
    const authUrl = `https://${AUTH0_DOMAIN}/authorize?` +
      `response_type=code&` +
      `client_id=${AUTH0_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=openid%20profile%20email&` +
      `state=${searchParams.get("state") || ""}`;

    return Response.redirect(authUrl, 302);
  }

  if (action === "callback") {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    
    if (!code) {
      return new Response("Missing authorization code", { status: 400 });
    }

    try {
      // Exchange code for token
      const tokenResponse = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: AUTH0_CLIENT_ID,
          client_secret: process.env.AUTH0_CLIENT_SECRET,
          code,
          redirect_uri: `${SITE_URL}/api/auth?action=callback`,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error("Failed to exchange code for token");
      }

      const tokens = await tokenResponse.json();

      // Get user info
      const userResponse = await fetch(`https://${AUTH0_DOMAIN}/userinfo`, {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!userResponse.ok) {
        throw new Error("Failed to get user info");
      }

      const user = await userResponse.json();

      // For Decap CMS, we need to return the token and user info
      // in a specific format and redirect to the admin page
      const adminUrl = `${SITE_URL}/admin/` +
        `#access_token=${tokens.access_token}&` +
        `token_type=Bearer&` +
        `expires_in=${tokens.expires_in}&` +
        `state=${state || ""}`;

      return Response.redirect(adminUrl, 302);
    } catch (error) {
      console.error("Auth callback error:", error);
      return new Response(`Authentication failed: ${error.message}`, { 
        status: 500 
      });
    }
  }

  return new Response("Invalid action", { status: 400 });
}