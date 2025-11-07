<template>
  <div class="login-container">
    <div class="form-container">
      <h1>로그인</h1>
      <form @submit.prevent="login">
        <div class="form-group">
          <label for="email">이메일</label>
          <input 
            type="email" 
            id="email"
            v-model="email"
            required
            placeholder="이메일을 입력하세요"
          />
        </div>
        
        <div class="form-group">
          <label for="password">비밀번호</label>
          <input 
            type="password" 
            id="password"
            v-model="password"
            required
            placeholder="비밀번호를 입력하세요"
          />
        </div>
        
        <div v-if="error" class="error-message">
          {{ error }}
        </div>
        
        <button type="submit" :disabled="loading">
          {{ loading ? '로그인 중...' : '로그인' }}
        </button>
      </form>

      <div class="social-login">
        <p>또는</p>
        <button @click="signInWithGoogle" class="google-login-btn" :disabled="loading">
          <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/768px-Google_%22G%22_logo.svg.png" alt="Google logo" />
          Google 계정으로 로그인
        </button>
      </div>
      
      <div class="alternate-action">
        <p>계정이 없으신가요? <router-link to="/signup">회원가입</router-link></p>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { auth } from '../firebase/config';
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export default {
  name: 'LoginView',
  setup() {
    const email = ref('');
    const password = ref('');
    const error = ref(null);
    const loading = ref(false);
    const router = useRouter();
    
    const login = async () => {
      error.value = null;
      loading.value = true;
      
      try {
        await signInWithEmailAndPassword(auth, email.value, password.value);
        router.push('/');
      } catch (err) {
        switch(err.code) {
          case 'auth/user-not-found':
            error.value = '이메일 주소를 찾을 수 없습니다.';
            break;
          case 'auth/wrong-password':
            error.value = '비밀번호가 올바르지 않습니다.';
            break;
          case 'auth/invalid-credential': // This often covers both user-not-found and wrong-password for newer SDK versions
            error.value = '이메일 또는 비밀번호가 올바르지 않습니다.';
            break;
          default:
            error.value = '로그인에 실패했습니다. 다시 시도해주세요.';
        }
      } finally {
        loading.value = false;
      }
    };

    const signInWithGoogle = async () => {
      error.value = null;
      loading.value = true;
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
        router.push('/');
      } catch (err) {
        switch(err.code) {
          case 'auth/popup-closed-by-user':
            error.value = 'Google 로그인 팝업이 닫혔습니다.';
            break;
          case 'auth/cancelled-popup-request':
            error.value = 'Google 로그인 요청이 여러 번 있었습니다. 잠시 후 다시 시도해주세요.';
            break;
          case 'auth/account-exists-with-different-credential':
             error.value = '이미 다른 방식으로 가입된 이메일입니다. 기존 방식으로 로그인해주세요.';
            break;
          default:
            error.value = 'Google 로그인에 실패했습니다. 다시 시도해주세요.';
            console.error('Google Sign-In Error:', err);
        }
      } finally {
        loading.value = false;
      }
    };
    
    return {
      email,
      password,
      error,
      loading,
      login,
      signInWithGoogle
    };
  }
};
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background-color: #f5f5f5;
}

.form-container {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

h1 {
  text-align: center;
  color: #333;
  margin-bottom: 1.5rem;
}

.form-group {
  margin-bottom: 1.5rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: #333;
}

input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

button {
  width: 100%;
  padding: 0.75rem;
  background-color: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: background-color 0.3s;
}

button:hover {
  background-color: #45a049;
}

button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

.error-message {
  color: #f44336;
  margin-bottom: 1rem;
  font-size: 0.875rem;
}

.social-login {
  margin-top: 1.5rem;
  margin-bottom: 1rem;
  text-align: center;
}

.social-login p {
  margin-bottom: 0.75rem;
  color: #666;
}

.google-login-btn {
  background-color: #fff;
  color: #444;
  border: 1px solid #ddd;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.google-login-btn:hover {
  background-color: #f9f9f9;
}

.google-login-btn img {
  width: 18px;
  height: 18px;
}

.alternate-action {
  margin-top: 1.5rem;
  text-align: center;
  font-size: 0.875rem;
}

a {
  color: #4caf50;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}
</style> 