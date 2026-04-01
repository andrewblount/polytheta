import { admin } from "@netlify/identity";

type CreateUserPayload = {
  operation: "create-user";
  email: string;
  password: string;
  fullName: string;
  role: "admin" | "member";
};

type UpdateUserPayload = {
  operation: "update-user";
  identityUserId: string;
  fullName?: string;
  role: "admin" | "member";
  password?: string;
};

type Payload = CreateUserPayload | UpdateUserPayload;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

const handler = async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const expectedToken = process.env.INTERNAL_SYNC_TOKEN;
  const providedToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expectedToken || providedToken !== expectedToken) {
    return unauthorized();
  }

  let payload: Payload;

  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    if (payload.operation === "create-user") {
      const created = await admin.createUser({
        email: payload.email,
        password: payload.password,
        data: {
          role: payload.role,
          user_metadata: {
            full_name: payload.fullName,
          },
        },
      });

      return json({
        id: created.id,
        email: created.email,
        role: created.role ?? payload.role,
      });
    }

    await admin.updateUser(payload.identityUserId, {
      role: payload.role,
      password: payload.password,
      user_metadata: payload.fullName
        ? {
            full_name: payload.fullName,
          }
        : undefined,
    });
    return json({ ok: true });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Identity admin operation failed.",
      },
      400,
    );
  }
};

export default handler;
