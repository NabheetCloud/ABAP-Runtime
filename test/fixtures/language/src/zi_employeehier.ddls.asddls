@EndUserText.label: 'Employee hierarchy'
define hierarchy ZI_EmployeeHier
  as parent child hierarchy (
    source ZI_Employee
    child to parent association _Manager
    start where ManagerId is initial
    siblings order by Name ascending
  )
{
  key EmpId,
      ManagerId,
      Name,
      $node.hierarchy_level     as HierarchyLevel,
      $node.hierarchy_rank      as HierarchyRank,
      $node.hierarchy_tree_size as TreeSize,
      $node.parent_id           as ParentId
}
