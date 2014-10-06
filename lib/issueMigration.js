// Get all issues in gh
// Get all issues in jira
// Get all subtasks in jira
// Create gh issues for all jira issues
// If subtask, add comment
var collectIssues = function collectIssues(){
    var ghIssues = getGhIssues();
    var jiraIssues = getJiraIssues();

};

// Get all ghIssues for all repos
var getGhIssues = function getGhIssues() {
    async (function() {
        var ghIssues = await (function(){
            var issueList = [];
            issueList._.union(_.each(context.config.github.repos, function(repo){
                return getSprintIssues(repo);
            }), issueList);
            return issueList;
        });

        console.log("open issues in github " + ghIssues.length);

        var ghClosedIssues = await (function(){
            var issueList = [];
            issueList._.union(_.each(context.config.github.repos, function(repo){
                return getClosedSprintIssues(repo);
            }), issueList);
        });

        console.log("closed issues in github " + ghClosedIssues.length);
    });
};

var getOpenGhIssues = function getOpenGhIssues(repo) {
    var filter = _.extend({
        //milestone: context.milestone.number,
        sort: 'updated',
        direction: 'desc',
        repo: repo,
        per_page: 100
    }, context.config.github);
    // Need to check all repos for issue list to not duplicate
    return context.api.github.issues.repoIssues(filter, function saveGhIssues(error, issues) {
        //context.ghIssues = _.union(context.ghIssues, issues);
        console.log('Got ' + issues.length + ' issues open from milestone on GH in repo ' + repo );
        return issues;
    });
};

var getClosedGhIssues = function getClosedGhIssues(repo){
    var filter = _.extend({
        state: 'closed',
        sort: 'updated',
        direction: 'desc',
        per_page: 100,
        repo: repo
    }, context.config.github);
    return context.api.github.issues.repoIssues(filter, function saveGhIssues(error, issues) {
        console.log('Got ' + issues.length + ' issues closed from milestone on GH from repo ' + repo );
        return issues;
    });
};

var getJiraIssues = function getJiraIssues() {

    var jiraIssues = await(function (currentSprint) {
        var masterIssues = context.api.jira.greenhopper.getSprintIssues(currentSprint.rapidView.id, currentSprint.sprint.id, function (error, result) {
            callback(_.union(result.contents.completedIssues, result.contents.incompletedIssues));
        });
        return masterIssues;
    });
};




    var jiraIssues = await (function(currentSprint) {
        var masterIssues = context.api.jira.greenhopper.getSprintIssues(currentSprint.rapidView.id, currentSprint.sprint.id, function (error, result) {
            return _.union(result.contents.completedIssues, result.contents.incompletedIssues);
        });

        var subIssues = async.each(masterIssues, addJiraSubtasks, function completed(err) {
            context.jiraOpenIssues = _.union(result.contents.incompletedIssues, context.subIssues);
            var issues = _.union(result.contents.incompletedIssues, context.subIssues); // clone
            generateGithubIssues(issues, null, callback);
        });

    });
};