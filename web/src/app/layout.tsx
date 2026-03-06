'use client';

import { usePathname } from 'next/navigation';
import Providers from "@/components/Providers";
import Navigation from "@/components/Navigation";
import "./globals.css";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-gray-50 text-gray-900 selection:bg-blue-100 selection:text-blue-900 font-sans">
        <Providers>
          <div className="flex h-screen w-screen overflow-hidden">
            {/* Standard SaaS Sidebar */}
            <Navigation />
            
            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-gray-50 overflow-hidden relative">
               <div className="absolute inset-0 overflow-y-auto">
                 {children}
               </div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
