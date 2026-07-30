import AuthGate from './src/auth/AuthGate';
import AppV5 from './src/AppV5';

export default function App() {
  return (
    <AuthGate>
      <AppV5 />
    </AuthGate>
  );
}
