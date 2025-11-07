<template>
  <div class="signup-container">
    <div class="form-container">
      <h1>회원가입</h1>
      <form @submit.prevent="signup">
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
            minlength="6"
          />
          <small class="password-hint">비밀번호는 최소 6자 이상이어야 합니다.</small>
        </div>

        <div class="form-group">
          <label for="confirmPassword">비밀번호 확인</label>
          <input 
            type="password" 
            id="confirmPassword"
            v-model="confirmPassword"
            required
            placeholder="비밀번호를 다시 입력하세요"
          />
        </div>
        
        <div v-if="error" class="error-message">
          {{ error }}
        </div>
        
        <button type="submit" :disabled="loading || !isFormValid">
          {{ loading ? '가입 중...' : '회원가입' }}
        </button>
      </form>
      
      <div class="alternate-action">
        <p>이미 계정이 있으신가요? <router-link to="/login">로그인</router-link></p>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { auth } from '../firebase/config';
import { createUserWithEmailAndPassword } from 'firebase/auth';

export default {
  name: 'SignUpView',
  setup() {
    const email = ref('');
    const password = ref('');
    const confirmPassword = ref('');
    const error = ref(null);
    const loading = ref(false);
    const router = useRouter();
    
    const isFormValid = computed(() => {
      return email.value && 
             password.value && 
             confirmPassword.value && 
             password.value === confirmPassword.value &&
             password.value.length >= 6;
    });
    
    const signup = async () => {
      if (!isFormValid.value) {
        if (password.value !== confirmPassword.value) {
          error.value = '비밀번호가 일치하지 않습니다.';
        }
        return;
      }
      
      error.value = null;
      loading.value = true;
      
      try {
        await createUserWithEmailAndPassword(auth, email.value, password.value);
        router.push('/');
      } catch (err) {
        switch(err.code) {
          case 'auth/email-already-in-use':
            error.value = '이미 사용 중인 이메일 주소입니다.';
            break;
          case 'auth/invalid-email':
            error.value = '유효하지 않은 이메일 형식입니다.';
            break;
          case 'auth/weak-password':
            error.value = '비밀번호가 너무 약합니다.';
            break;
          default:
            error.value = '회원가입에 실패했습니다. 다시 시도해주세요.';
        }
      } finally {
        loading.value = false;
      }
    };
    
    return {
      email,
      password,
      confirmPassword,
      error,
      loading,
      isFormValid,
      signup
    };
  }
};
</script>

<style scoped>
.signup-container {
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

.password-hint {
  display: block;
  margin-top: 0.3rem;
  color: #666;
  font-size: 0.75rem;
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