import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyReviewToken } from "@/lib/registry-tokens";

function htmlPage(title: string, message: string, color: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f0eb;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 48px 40px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    .icon {
      width: 56px;
      height: 56px;
      border-radius: 14px;
      background: ${color}18;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 26px;
    }
    h1 {
      color: #1a2e1a;
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    p {
      color: #6b6b6b;
      font-size: 14px;
      line-height: 1.6;
    }
    .badge {
      display: inline-block;
      margin-top: 24px;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      background: ${color}18;
      color: ${color};
    }
    .footer {
      margin-top: 32px;
      color: #bbb;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === "#1a7a1a" ? "✓" : "✕"}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="badge">${color === "#1a7a1a" ? "Aprobado" : "Rechazado"}</div>
    <p class="footer">Mullybox · Club Registry Admin</p>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return htmlPage(
      "Link inválido",
      "No se encontró un token en la URL.",
      "#c0392b"
    );
  }

  const payload = verifyReviewToken(token);
  if (!payload) {
    return htmlPage(
      "Link expirado o inválido",
      "Este link de revisión ya no es válido. Puede haber expirado (7 días) o haber sido alterado.",
      "#c0392b"
    );
  }

  const { uid, action } = payload;
  const newStatus = action === "approve" ? "approved" : "rejected";

  const ref = adminDb.collection("registry_applications").doc(uid);
  const snap = await ref.get();

  if (!snap.exists) {
    return htmlPage(
      "Solicitud no encontrada",
      "No se encontró una solicitud activa para este usuario.",
      "#c0392b"
    );
  }

  const current = snap.data()?.status as string | undefined;

  // Idempotent — already processed
  if (current === "approved" || current === "rejected") {
    return htmlPage(
      "Solicitud ya procesada",
      `Esta solicitud ya fue ${current === "approved" ? "aprobada" : "rechazada"} anteriormente.`,
      current === "approved" ? "#1a7a1a" : "#c0392b"
    );
  }

  await ref.update({ status: newStatus, reviewed_at: new Date().toISOString() });

  if (action === "approve") {
    return htmlPage(
      "Solicitud aprobada",
      "El miembro ahora tiene acceso completo al Club Registry privado.",
      "#1a7a1a"
    );
  }

  return htmlPage(
    "Solicitud rechazada",
    "La solicitud fue rechazada. El miembro no tendrá acceso al Club Registry.",
    "#c0392b"
  );
}
