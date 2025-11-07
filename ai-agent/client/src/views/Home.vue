<template>
  <div class="home-container">
    <div class="dashboard">
      <header class="dashboard-header">
        <h1>AI 에이전트 대시보드</h1>
        <div class="user-menu">
          <span class="user-email">{{ userEmail }}</span>
          <button @click="logout" class="logout-btn">로그아웃</button>
        </div>
      </header>

      <main class="dashboard-content">
        <div class="welcome-section">
          <h2>환영합니다, {{ userEmail }}님!</h2>
          <p>AI 에이전트 플랫폼에서는 다양한 웹 작업을 자동화할 수 있습니다.</p>
        </div>

        <section class="actions-section">
          <div class="action-card" @click="goToTaskSubmission">
            <div class="card-icon">📝</div>
            <h3>새 작업 생성</h3>
            <p>새로운 웹 자동화 작업을 생성하고 실행합니다.</p>
            <button class="action-btn">작업 생성하기</button>
          </div>

          <div class="action-card">
            <div class="card-icon">📊</div>
            <h3>실행 내역 확인</h3>
            <p>이전에 실행한 작업의 기록과 결과를 확인합니다.</p>
            <button class="action-btn">내역 보기</button>
          </div>
        </section>

        <section class="recent-tasks">
          <h2>최근 작업</h2>
          <div class="no-tasks" v-if="!hasTasks">
            <p>아직 실행한 작업이 없습니다.</p>
            <p>새 작업을 생성하여 AI 에이전트를 경험해보세요!</p>
          </div>
          <!-- 여기에 최근 작업 목록 렌더링 -->
        </section>
      </main>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { auth } from '../firebase/config';
import { signOut, onAuthStateChanged } from 'firebase/auth';

export default {
  name: 'HomeView',
  setup() {
    const user = ref(null);
    const router = useRouter();
    const hasTasks = ref(false); // 실제로는 DB에서 작업 내역을 가져와서 확인
    
    const userEmail = computed(() => {
      return user.value ? user.value.email : '';
    });
    
    onMounted(() => {
      const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        if (currentUser) {
          user.value = currentUser;
        } else {
          // 로그인하지 않은 경우 로그인 페이지로 리다이렉트
          router.push('/login');
        }
      });
      
      // 컴포넌트 언마운트 시 구독 해제
      return () => unsubscribe();
    });
    
    const logout = async () => {
      try {
        await signOut(auth);
        router.push('/login');
      } catch (error) {
        console.error('로그아웃 중 오류 발생:', error);
      }
    };
    
    const goToTaskSubmission = () => {
      router.push('/task');
    };
    
    return {
      user,
      userEmail,
      hasTasks,
      logout,
      goToTaskSubmission
    };
  }
};
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #ddd;
}

.dashboard-header h1 {
  color: #333;
  margin: 0;
}

.user-menu {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.user-email {
  font-weight: 500;
  color: #555;
}

.logout-btn {
  background: none;
  border: none;
  color: #f44336;
  font-weight: 500;
  cursor: pointer;
  padding: 0.5rem;
  transition: color 0.3s;
}

.logout-btn:hover {
  color: #d32f2f;
  text-decoration: underline;
}

.welcome-section {
  background-color: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  margin-bottom: 2rem;
}

.welcome-section h2 {
  color: #333;
  margin-top: 0;
  margin-bottom: 1rem;
}

.welcome-section p {
  color: #666;
  margin-bottom: 0;
}

.actions-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.action-card {
  background-color: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transition: transform 0.3s, box-shadow 0.3s;
  cursor: pointer;
}

.action-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}

.card-icon {
  font-size: 2rem;
  margin-bottom: 1rem;
}

.action-card h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  color: #333;
}

.action-card p {
  color: #666;
  margin-bottom: 1.5rem;
}

.action-btn {
  background-color: #4caf50;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.3s;
}

.action-btn:hover {
  background-color: #45a049;
}

.recent-tasks {
  background-color: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.recent-tasks h2 {
  margin-top: 0;
  margin-bottom: 1.5rem;
  color: #333;
}

.no-tasks {
  text-align: center;
  padding: 2rem;
  color: #666;
}

.no-tasks p {
  margin: 0.5rem 0;
}
</style> 