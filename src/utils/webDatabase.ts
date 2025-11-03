import { User } from './databaseService';

class WebDatabaseService {
  private readonly STORAGE_KEY = 'swellyo_users';

  async saveUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    try {
      const users = this.getAllUsersFromStorage();
      
      // Check if user already exists
      const existingUserIndex = users.findIndex(user => user.googleId === userData.googleId);
      
      const now = new Date().toISOString();
      const user: User = {
        id: existingUserIndex >= 0 ? users[existingUserIndex].id : Date.now(),
        ...userData,
        createdAt: existingUserIndex >= 0 ? users[existingUserIndex].createdAt : now,
        updatedAt: now,
      };

      if (existingUserIndex >= 0) {
        users[existingUserIndex] = user;
      } else {
        users.push(user);
      }

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(users));
      console.log('User saved to localStorage:', user);
      return user;
    } catch (error) {
      console.error('Error saving user to localStorage:', error);
      throw error;
    }
  }

  async getUserByGoogleId(googleId: string): Promise<User | null> {
    try {
      const users = this.getAllUsersFromStorage();
      const user = users.find(user => user.googleId === googleId);
      return user || null;
    } catch (error) {
      console.error('Error getting user by Google ID from localStorage:', error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const users = this.getAllUsersFromStorage();
      const user = users.find(user => user.email === email);
      return user || null;
    } catch (error) {
      console.error('Error getting user by email from localStorage:', error);
      throw error;
    }
  }

  async getAllUsers(): Promise<User[]> {
    try {
      return this.getAllUsersFromStorage();
    } catch (error) {
      console.error('Error getting all users from localStorage:', error);
      throw error;
    }
  }

  async deleteUser(googleId: string): Promise<void> {
    try {
      const users = this.getAllUsersFromStorage();
      const filteredUsers = users.filter(user => user.googleId !== googleId);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredUsers));
    } catch (error) {
      console.error('Error deleting user from localStorage:', error);
      throw error;
    }
  }

  private getAllUsersFromStorage(): User[] {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error parsing users from localStorage:', error);
      return [];
    }
  }
}

export const webDatabaseService = new WebDatabaseService();
