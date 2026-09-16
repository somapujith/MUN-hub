export interface ProductAnalytics {
  productId: string;
  productName: string;
  price: number;
  capacity: number;
  registrationCount: number;
  revenue: number;
}

export interface MunAnalytics {
  totalRegistrations: number;
  totalRevenue: number;
  products: ProductAnalytics[];
}
