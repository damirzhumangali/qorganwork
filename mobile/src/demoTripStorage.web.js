import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDemoBrowserStorage } from './demoBrowserStorage';

export default createDemoBrowserStorage(AsyncStorage, typeof indexedDB === 'undefined' ? null : indexedDB);
