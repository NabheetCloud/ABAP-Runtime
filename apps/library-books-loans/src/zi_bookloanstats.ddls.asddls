@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Open Loans per Book'
define view entity ZI_BookLoanStats
  as select from zloan_a
{
  key parent_uuid as BookUUID,
      count( * )  as OpenLoans
}
where
  return_date is initial
group by
  parent_uuid
