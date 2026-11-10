@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Book - Projection'
@Metadata.allowExtensions: true
@Search.searchable: true
define root view entity ZC_Book
  provider contract transactional_query
  as projection on ZR_Book
{
  key BookUUID,
      @Search.defaultSearchElement: true
      Title,
      @Search.defaultSearchElement: true
      Author,
      @Search.defaultSearchElement: true
      ISBN,
      Genre,
      Copies,
      _LoanStats.OpenLoans as OpenLoans,
      CreatedBy,
      CreatedAt,
      LastChangedAt,
      LocalLastChangedAt,

      _Loan : redirected to composition child ZC_Loan,
      _LoanStats
}
