import ClientLogoutButton from "./logout-button";

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 2rem",
          borderBottom: "1px solid #ddd",
        }}
      >
        <strong>Delivery Verification System — Client Main Panel</strong>
        <ClientLogoutButton />
      </header>
      <div style={{ padding: "2rem" }}>{children}</div>
    </div>
  );
}
