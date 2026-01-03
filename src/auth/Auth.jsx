import React from 'react';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

const Auth = ({ auth, user }) => {

    const handleGoogleLogin = async () => {
        const provider = new GoogleAuthProvider();
        try {
            await signInWithPopup(auth, provider);
        } catch (error) {
            console.error("Google login failed:", error);
            alert("Could not sign in with Google. Please try again.");
        }
    };

    const handleLogout = async () => {
        try {
            await signOut(auth);
        } catch (error) {
            console.error("Logout failed:", error);
        }
    };

    if (user) {
        return (
            <div className="flex items-center gap-2">
                <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full" />
                <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white">Logout</button>
            </div>
        );
    }

    return (
        <div className="bg-gray-900 min-h-screen flex flex-col items-center justify-center text-white p-4">
            <div className="text-center max-w-md">
                <h1 className="text-4xl font-bold mb-4 text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-500">Welcome to the Multi-TCG Companion</h1>
                <p className="text-gray-400 mb-8">Please sign in to manage your collections and build decks across all your favorite trading card games.</p>
                <button 
                    onClick={handleGoogleLogin}
                    className="flex items-center justify-center gap-3 px-6 py-3 bg-white text-gray-800 font-semibold rounded-lg hover:bg-gray-200 transition-colors"
                >
                    <svg className="w-6 h-6" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path><path fill="#34A652" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path><path fill="none" d="M0 0h48v48H0z"></path></svg>
                    Sign In with Google
                </button>
            </div>
        </div>
    );
};

export default Auth;
