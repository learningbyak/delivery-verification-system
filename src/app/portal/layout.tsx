import PortalLogoutButton from "./logout-button";
import IdleTimeout from "./idle-timeout";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <IdleTimeout />
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem",
          borderBottom: "1px solid #ddd",
        }}
      >
        <strong style={{ fontSize: "0.95rem" }}>Delivery Scanning</strong>
        <PortalLogoutButton />
      </header>
      <div style={{ padding: "1rem" }}>{children}</div>
    </div>
  );
}
