@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Book'
define root view entity ZR_Book
  as select from zbook_a
  composition [0..*] of ZR_Loan          as _Loan
  association [0..1] to ZI_BookLoanStats as _LoanStats on $projection.BookUUID = _LoanStats.BookUUID
{
  key book_uuid             as BookUUID,
      title                 as Title,
      author                as Author,
      isbn                  as ISBN,
      genre                 as Genre,
      copies                as Copies,
      @Semantics.user.createdBy: true
      created_by            as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at            as CreatedAt,
      @Semantics.user.lastChangedBy: true
      last_changed_by       as LastChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at       as LastChangedAt,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt,

      _Loan,
      _LoanStats
}
