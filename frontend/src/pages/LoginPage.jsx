import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import toast from "react-hot-toast";
import { Spinner } from "@/components/ui";
import { parseApiError } from "@/utils/format";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Login berhasil");
      navigate("/");
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{
        background:
          "radial-gradient(circle at 12% 14%, rgba(91,139,255,0.18) 0%, transparent 55%), " +
          "radial-gradient(circle at 88% 86%, rgba(110,231,247,0.10) 0%, transparent 55%), " +
          "linear-gradient(180deg, #060d1e 0%, #0a1530 100%)",
      }}
    >
      {/* Floating orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute -top-[15%] -left-[8%] rounded-full"
          style={{
            width: 700,
            height: 700,
            background:
              "radial-gradient(circle, rgba(79,124,255,0.18) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute -bottom-[20%] -right-[10%] rounded-full"
          style={{
            width: 600,
            height: 600,
            background:
              "radial-gradient(circle, rgba(110,231,247,0.10) 0%, transparent 65%)",
          }}
        />
      </div>

      <div className="w-full max-w-[420px] relative">
        {/* Header (logo + title) */}
        <div className="text-center mb-9">
          <div
            className="w-[60px] h-[60px] mx-auto mb-[18px] flex items-center justify-center"
            style={{
              borderRadius: 18,
              background: "linear-gradient(135deg, #5b8bff 0%, #2d54e0 100%)",
              boxShadow: "0 8px 36px rgba(79,124,255,0.55)",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1
            className="text-white"
            style={{
              fontFamily: "Lexend, sans-serif",
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            Marlin
          </h1>
          <p
            className="mt-2 uppercase"
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.35)",
              letterSpacing: "0.12em",
            }}
          >
            Monitoring · Analysis · Reporting · Learning
          </p>
        </div>

        {/* Glass card */}
        <div
          className="p-9"
          style={{
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 16,
          }}
        >
          <h2
            className="text-white mb-1"
            style={{
              fontFamily: "Lexend, sans-serif",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            Selamat Datang
          </h2>
          <p
            className="mb-7"
            style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}
          >
            Masuk menggunakan akun yang diberikan administrator
          </p>

          <form onSubmit={submit} className="flex flex-col gap-[18px]">
            <div>
              <label
                className="block mb-1.5 uppercase tracking-wider"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                Email
              </label>
              <input
                type="email"
                className="w-full px-3.5 py-3 rounded-xl outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.11)",
                  color: "white",
                  fontSize: 14,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(91,139,255,0.6)";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(91,139,255,0.15)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor =
                    "rgba(255,255,255,0.11)";
                  e.currentTarget.style.boxShadow = "none";
                }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@kkp.go.id"
                required
                autoFocus
              />
            </div>
            <div>
              <label
                className="block mb-1.5 uppercase tracking-wider"
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                Password
              </label>
              <input
                type="password"
                className="w-full px-3.5 py-3 rounded-xl outline-none transition-all"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.11)",
                  color: "white",
                  fontSize: 14,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(91,139,255,0.6)";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(91,139,255,0.15)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor =
                    "rgba(255,255,255,0.11)";
                  e.currentTarget.style.boxShadow = "none";
                }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full flex items-center justify-center gap-2.5 transition-all"
              style={{
                padding: 13,
                borderRadius: 12,
                border: "none",
                cursor: loading ? "default" : "pointer",
                background: loading
                  ? "rgba(91,139,255,0.4)"
                  : "linear-gradient(135deg, #5b8bff 0%, #2d54e0 100%)",
                color: "white",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: "inherit",
                boxShadow: "0 4px 28px rgba(79,124,255,0.4)",
              }}
            >
              {loading && <Spinner size={16} />}
              {loading ? "Memverifikasi..." : "Masuk ke Sistem"}
            </button>
          </form>

          <p
            className="text-center mt-7"
            style={{ fontSize: 11, color: "rgba(255,255,255,0.18)" }}
          >
            © 2025 Kementerian Kelautan dan Perikanan RI — v2.0
          </p>
        </div>
      </div>
    </div>
  );
}
