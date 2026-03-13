import { ref, get, set, update, onValue, runTransaction, type Unsubscribe } from 'firebase/database';
import { db } from '../api/firebase';

export function subscribeToProducts(
  callback: (products: Record<string, any>[]) => void
): Unsubscribe {
  const productsRef = ref(db, 'products');
  return onValue(productsRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback([]);
      return;
    }
    const data = snapshot.val();
    const list = Object.entries(data).map(([id, val]: [string, any]) => ({
      id,
      ...val,
    }));
    callback(list);
  });
}

export function updateStock(productId: string, quantity: number) {
  const stockRef = ref(db, `products/${productId}/stock`);
  return runTransaction(stockRef, (currentStock: number | null) => {
    return (currentStock ?? 0) + quantity;
  });
}

export function saveProduct(id: string, data: Record<string, any>) {
  return set(ref(db, `products/${id}`), {
    ...data,
    updatedAt: Date.now(),
  });
}
