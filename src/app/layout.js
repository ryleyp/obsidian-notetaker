import "./globals.css";

export const metadata = {
  title: "Obsidian Meeting Notes",
  description: "AI-powered meeting notes for your Obsidian vault",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
