export const ALLOWANCE_FIELDS = [
  ["allowLiving", "Living Allowance"],
  ["allowGas", "Gas Allowance"],
  ["allowMotor", "Motor Allowance"],
  ["allowLoad", "Load Allowance"],
  ["allowTravel", "Travel Allowance"],
] as const;

export const DEDUCTION_FIELDS = [
  ["dedSss", "SSS Contribution"],
  ["dedHdmf", "HDMF Contribution"],
  ["dedPhic", "PHIC Contribution"],
  ["dedSssSalaryLoan", "SSS Salary Loan"],
  ["dedSssCalamityLoan", "SSS Calamity Loan"],
  ["dedHdmfMplLoan", "HDMF MPL Loan"],
  ["dedHdmfCalamityLoan", "HDMF Calamity Loan"],
  ["dedSalaryLoan", "Salary Loan"],
  ["dedWithholdingTax", "Withholding Tax"],
  ["dedOthers", "Others"],
] as const;

export type AllowanceKey = (typeof ALLOWANCE_FIELDS)[number][0];
export type DeductionKey = (typeof DEDUCTION_FIELDS)[number][0];
