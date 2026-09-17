export interface ProductAnalytics {
  productId: string;
  productName: string;
  price: number;
  capacity: number;
  registrationCount: number;
  /** Gross collected: what delegates paid, platform fee and GST included. */
  revenue: number;
  /** Net to the organizer: `revenue` minus MUN Hub's platform fee and the GST on it. */
  organizerNet: number;
}

export interface MunAnalytics {
  totalRegistrations: number;
  /** Gross collected across every pass. */
  totalRevenue: number;
  /** Net to the organizer across every pass. */
  totalOrganizerNet: number;
  products: ProductAnalytics[];
}
