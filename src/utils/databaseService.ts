import { Platform } from 'react-native';

export interface User {
  id: number;
  email: string;
  nickname: string;
  googleId: string;
  createdAt: string;
  updatedAt: string;
}

// Web database service using localStorage
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

// Native database service using AsyncStorage (for now, until we can properly configure SQLite)
class NativeDatabaseService {
  private readonly STORAGE_KEY = 'swellyo_users';

  async init(): Promise<void> {
    console.log('Native database service initialized (using AsyncStorage)');
  }

  async saveUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      const users = await this.getAllUsersFromStorage(AsyncStorage);
      
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

      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(users));
      console.log('User saved to AsyncStorage:', user);
      return user;
    } catch (error) {
      console.error('Error saving user to AsyncStorage:', error);
      throw error;
    }
  }

  async getUserByGoogleId(googleId: string): Promise<User | null> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      const users = await this.getAllUsersFromStorage(AsyncStorage);
      const user = users.find(user => user.googleId === googleId);
      return user || null;
    } catch (error) {
      console.error('Error getting user by Google ID from AsyncStorage:', error);
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      const users = await this.getAllUsersFromStorage(AsyncStorage);
      const user = users.find(user => user.email === email);
      return user || null;
    } catch (error) {
      console.error('Error getting user by email from AsyncStorage:', error);
      throw error;
    }
  }

  async getAllUsers(): Promise<User[]> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      return await this.getAllUsersFromStorage(AsyncStorage);
    } catch (error) {
      console.error('Error getting all users from AsyncStorage:', error);
      throw error;
    }
  }

  async deleteUser(googleId: string): Promise<void> {
    try {
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      const users = await this.getAllUsersFromStorage(AsyncStorage);
      const filteredUsers = users.filter(user => user.googleId !== googleId);
      await AsyncStorage.setItem(this.STORAGE_KEY, JSON.stringify(filteredUsers));
    } catch (error) {
      console.error('Error deleting user from AsyncStorage:', error);
      throw error;
    }
  }

  private async getAllUsersFromStorage(AsyncStorage: any): Promise<User[]> {
    try {
      const stored = await AsyncStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Error parsing users from AsyncStorage:', error);
      return [];
    }
  }
}

// Unified database service
class UnifiedDatabaseService {
  private webService = new WebDatabaseService();
  private nativeService = new NativeDatabaseService();

  async init(): Promise<void> {
    if (Platform.OS === 'web') {
      console.log('Web platform detected, using localStorage');
      return;
    }
    
    await this.nativeService.init();
    console.log('SQLite database initialized');
  }

  async saveUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    if (Platform.OS === 'web') {
      return this.webService.saveUser(userData);
    }
    return this.nativeService.saveUser(userData);
  }

  async getUserByGoogleId(googleId: string): Promise<User | null> {
    if (Platform.OS === 'web') {
      return this.webService.getUserByGoogleId(googleId);
    }
    return this.nativeService.getUserByGoogleId(googleId);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    if (Platform.OS === 'web') {
      return this.webService.getUserByEmail(email);
    }
    return this.nativeService.getUserByEmail(email);
  }

  async getAllUsers(): Promise<User[]> {
    if (Platform.OS === 'web') {
      return this.webService.getAllUsers();
    }
    return this.nativeService.getAllUsers();
  }

  async deleteUser(googleId: string): Promise<void> {
    if (Platform.OS === 'web') {
      return this.webService.deleteUser(googleId);
    }
    return this.nativeService.deleteUser(googleId);
  }
}

export const databaseService = new UnifiedDatabaseService();
