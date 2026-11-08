export type ExpenseMap = Record<string, number>;

export type BusinessSettings = {
  _id?: string;
  name: string;
  currency: 'INR';
  dateFormat: 'DD-MMM-YYYY';
  openingOnlineBalance: number;
  openingCashBalance: number;
  vendors: string[];
  expenseCategories: string[];
  updatedAt?: string;
};

export type DailyEntry = {
  _id?: string;
  businessId: string;
  date: string;
  onlineSales: number;
  cashSales: number;
  expenses: ExpenseMap;
  expensePaidOnline: number;
  expensePaidCash: number;
  savingsOnline?: number;
  savingsCash?: number;
  notes: string;
  createdAt?: string;
  updatedAt?: string;
};

export type DailySaving = {
  _id?: string;
  businessId: string;
  date: string;
  onlineAmount: number;
  cashAmount: number;
  notes: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type PurchaseEntry = {
  _id?: string;
  businessId: string;
  purchaseDate: string;
  paymentDate: string | null;
  vendorAmounts: Record<string, number>;
  onlinePurchasePaid: number;
  cashPurchasePaid: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SalaryPayment = { person: string; amount: number; paidOnline?: number; paidCash?: number; paymentDate?: string };
export type PartnerSavingsPayment = { partner: string; amount: number; paymentDate?: string };
export type SavingsDeposit = { date: string; amount: number; note?: string };
export type FinanceMonth = {
  _id?: string;
  businessId: string;
  period: string;
  year: number;
  month: number;
  salaries: SalaryPayment[];
  truckEmi: number;
  truckEmiPaymentDate?: string;
  autoEmi: number;
  autoEmiFriendShare?: number;
  autoEmiPaymentDate?: string;
  roomRent: number;
  roomRentPaymentDate?: string;
  savingsDeposit: number;
  savingsEntries?: SavingsDeposit[];
  partnerPayments: PartnerSavingsPayment[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type RentPayment = {
  _id?: string;
  businessId: string;
  period: string;
  amount: number;
  paymentDate: string;
  status: 'paid' | 'pending';
  notes: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type PartnerPaymentTransaction = {
  recipient: 'friend' | 'investors' | 'investor1' | 'investor2';
  amount: number;
  paymentDate: string;
  note?: string;
};

export type PartnerDistribution = {
  _id?: string;
  businessId: string;
  period: string;
  approvedAmount: number;
  friendAllocation: number;
  investorAllocation: number;
  investor1Percent?: number;
  investor2Percent?: number;
  payments: PartnerPaymentTransaction[];
  notes: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export type LoanRepayment = { date: string; amount: number };
export type FinanceLoan = {
  _id?: string;
  businessId: string;
  person: string;
  source: 'friend' | 'partner' | 'other';
  amountTaken: number;
  takenDate: string;
  repayments: LoanRepayment[];
  notes: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type VendorRefundReceipt = { date: string; amount: number };
export type VendorDefectReturn = {
  _id?: string;
  businessId: string;
  vendor: string;
  returnDate: string;
  amount: number;
  receipts: VendorRefundReceipt[];
  notes: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type MonthlyDashboard = {
  year: number;
  month: number;
  onlineSales: number;
  cashSales: number;
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  totalBalance: number;
  netAmount: number;
  dailySalary: number;
  dailyOperatingExpenses: number;
  rent: number;
  latestDay: { date: string | null; sales: number; expenses: number; net: number };
  daily: Array<{ day: number; label: string; sales: number; onlineSales: number; cashSales: number; expenses: number }>;
  expenseBreakdown: Array<{ name: string; amount: number }>;
  vendorPurchases: Array<{ name: string; amount: number }>;
  purchaseRelatedExpenses: { other: number; transport: number; total: number; purchaseOutflow: number };
  purchaseStatus: { paid: number; pending: number };
  opening: { online: number; cash: number };
  closing: { online: number; cash: number };
  approvedDistribution: number;
};

export type YearlyMonth = {
  month: number;
  label: string;
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  netAmount: number;
  closingBalance: number;
};

export type YearlyDashboard = {
  year: number;
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  netAmount: number;
  closingBalance: number;
  months: YearlyMonth[];
};

export type ViewerMonthlyDashboard = {
  year: number;
  month: number;
  totalSales: number;
  onlineSales: number;
  cashSales: number;
  totalPurchases: number;
  salesAfterPurchases: number;
  daily: Array<{ day: number; label: string; sales: number; onlineSales: number; cashSales: number }>;
  vendorPurchases: Array<{ name: string; amount: number }>;
};

export type ViewerYearlyDashboard = {
  year: number;
  totalSales: number;
  totalPurchases: number;
  salesAfterPurchases: number;
  months: Array<{ month: number; label: string; totalSales: number; totalPurchases: number; salesAfterPurchases: number }>;
};

export type MonthlyFinanceSummary = {
  salaries: number;
  truckEmi: number;
  autoEmi: number;
  autoEmiFriendShare?: number;
  autoEmiTotal?: number;
  roomRent: number;
  savingsDeposit: number;
  partnerPayments: number;
  savingsBalance: number;
  loanRepayments: number;
  loanOutstanding: number;
  vendorCreditsPending: number;
  vendorCreditsReceived: number;
};
