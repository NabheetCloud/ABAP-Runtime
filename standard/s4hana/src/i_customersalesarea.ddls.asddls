@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Customer Sales Area'
@VDM.viewType: #BASIC
@ObjectModel.usageType.dataClass: #MASTER
define view entity I_CustomerSalesArea
  as select from knvv
{
  key kunnr as Customer,
  key vkorg as SalesOrganization,
  key vtweg as DistributionChannel,
  key spart as Division,
      waers as Currency,
      zterm as CustomerPaymentTerms,
      inco1 as IncotermsClassification,
      inco2 as IncotermsTransferLocation,
      vsbed as ShippingCondition,
      konda as CustomerPriceGroup,
      kalks as CustomerPricingProcedure,
      aufsd as SalesIsBlockedForCustomer,
      loevm as DeletionIndicator
}
