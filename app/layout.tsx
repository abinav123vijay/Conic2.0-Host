import './globals.css';
import './theme.css';
import Shell from '@/components/Shell';
export const metadata={title:'CONIC Business System',description:'CONIC multi-device business dashboard'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><Shell>{children}</Shell></body></html>}
